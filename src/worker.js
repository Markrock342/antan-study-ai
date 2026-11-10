// Cloudflare Worker ของ "อ่านทัน"
// - หน้าเว็บมาจาก Static Assets (public/)
// - /api/* : เอกสารแต่ละชิ้นเป็น Durable Object หนึ่งตัว เก็บข้อความ ท่อนเนื้อหา และ embedding ใน SQLite
// - AI ใช้ Workers AI: SEA-LION (แชต/สรุป/ข้อสอบ ภาษาไทย) และ bge-m3 (embedding หลายภาษา)
import { DurableObject } from "cloudflare:workers";
import { ask, getDoc, ingest, makeQuiz, remove, summarize } from "./lib/engine.js";
import { handleApi } from "./lib/http.js";

const DOC_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/* ---------- Workers AI ---------- */

function aiError(error) {
  const message = String(error?.message || error);
  if (/4006|daily free allocation|neurons/i.test(message)) {
    const e = new Error("วันนี้ใช้ AI ครบโควตาฟรีแล้ว ลองใหม่พรุ่งนี้");
    e.status = 429;
    return e;
  }
  const e = new Error("เรียกใช้ AI ไม่สำเร็จ ลองใหม่อีกครั้ง");
  e.status = 502;
  e.cause = message;
  return e;
}

export function workersAI(env) {
  return {
    async chat(messages, { json: wantJson = false, maxTokens = 1024 } = {}) {
      const options = { messages, max_tokens: maxTokens, temperature: wantJson ? 0.2 : 0.4 };
      if (wantJson) options.response_format = { type: "json_object" };
      let result;
      try {
        result = await env.AI.run(env.CHAT_MODEL, options);
      } catch (error) {
        throw aiError(error);
      }
      const out = result?.response ?? result?.choices?.[0]?.message?.content ?? "";
      return typeof out === "string" ? out : JSON.stringify(out);
    },
    async embed(texts) {
      let result;
      try {
        result = await env.AI.run(env.EMBED_MODEL, { text: texts, truncate_inputs: true });
      } catch (error) {
        throw aiError(error);
      }
      return result?.data ?? result?.response ?? [];
    },
  };
}

/* ---------- Durable Object: เอกสารหนึ่งชิ้น ---------- */

export class DocStore extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS chunks (i INTEGER PRIMARY KEY, text TEXT NOT NULL, vec BLOB NOT NULL);
    `);
    this.chunkCache = null;
    this.ai = workersAI(env);
  }

  // storage adapter ที่ engine ใช้
  get store() {
    const sql = this.sql;
    const read = (k) => sql.exec("SELECT v FROM kv WHERE k = ?", k).toArray()[0]?.v;
    const write = (k, v) => sql.exec("INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v", k, v);
    return {
      getMeta: () => {
        const v = read("meta");
        return v ? JSON.parse(v) : null;
      },
      getText: () => read("text") ?? "",
      getChunks: () => {
        if (!this.chunkCache) {
          this.chunkCache = sql
            .exec("SELECT i, text, vec FROM chunks ORDER BY i")
            .toArray()
            .map((row) => ({ index: row.i, text: row.text, vector: new Float32Array(row.vec) }));
        }
        return this.chunkCache;
      },
      saveDoc: (meta, text, chunks) => {
        this.ctx.storage.transactionSync(() => {
          sql.exec("DELETE FROM kv");
          sql.exec("DELETE FROM chunks");
          write("meta", JSON.stringify(meta));
          write("text", text);
          for (const c of chunks) {
            sql.exec("INSERT INTO chunks (i, text, vec) VALUES (?, ?, ?)", c.index, c.text, new Float32Array(c.vector).buffer);
          }
        });
        this.chunkCache = null;
      },
      getCache: (key) => {
        const v = read(`cache:${key}`);
        return v ? JSON.parse(v) : null;
      },
      setCache: (key, value) => write(`cache:${key}`, JSON.stringify(value)),
      clear: () => {
        sql.exec("DELETE FROM kv");
        sql.exec("DELETE FROM chunks");
        this.chunkCache = null;
      },
    };
  }

  // จุดเข้าเดียวผ่าน RPC: คืน { status, body } เสมอ
  async call(action, args = {}) {
    try {
      let body;
      switch (action) {
        case "ingest":
          body = await ingest(this.store, this.ai, args);
          await this.ctx.storage.setAlarm(Date.now() + DOC_TTL_MS);
          return { status: 201, body };
        case "get":
          body = getDoc(this.store);
          break;
        case "summary":
          body = await summarize(this.store, this.ai, args);
          break;
        case "quiz":
          body = await makeQuiz(this.store, this.ai, args);
          break;
        case "ask":
          body = await ask(this.store, this.ai, args);
          break;
        case "delete":
          body = remove(this.store);
          await this.ctx.storage.deleteAlarm();
          break;
        default:
          return { status: 404, body: { message: "ไม่พบคำสั่งนี้" } };
      }
      return { status: 200, body };
    } catch (error) {
      if (!error.status) console.error(action, error);
      else if (error.cause) console.error(action, error.cause);
      return { status: error.status || 500, body: { message: error.status ? error.message : "เกิดข้อผิดพลาด ลองใหม่อีกครั้ง" } };
    }
  }

  // ครบ 30 วัน ลบเอกสารทิ้งอัตโนมัติ
  async alarm() {
    await this.ctx.storage.deleteAll();
    this.chunkCache = null;
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) return handleApi(request, env);
    return env.ASSETS.fetch(request);
  },
};
