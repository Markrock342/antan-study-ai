// ตรรกะหลักของแอป แยกจาก Cloudflare เพื่อให้เทสได้ด้วย AI และ storage ปลอม
//   ai    = { chat(messages, { json, maxTokens }) → string, embed(texts) → number[][] }
//   store = { getMeta, getText, getChunks, saveDoc, getCache, setCache, clear }
import { chunkText, groupChunks, normalizeText } from "./chunk.js";
import { topK } from "./retrieve.js";
import { askMessages, partialSummaryMessages, quizMessages, summaryMessages, LEVELS } from "./prompts.js";
import { bulletLines, citedNumbers, cleanAnswer, cleanQuiz, cleanSummary } from "./parse.js";

export const LIMITS = {
  minChars: 150,
  maxChars: 60_000,
  maxTitle: 120,
  maxQuestion: 500,
  quizCounts: [3, 5, 10],
  singleSummaryChars: 12_000,
  partChars: 9_000,
  quizWindowChars: 8_000,
  embedBatch: 50,
};

export function fail(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function requireDoc(store) {
  const meta = store.getMeta();
  if (!meta) throw fail(404, "ไม่พบเอกสารนี้ อาจถูกลบไปแล้ว");
  return meta;
}

// ลองซ้ำหนึ่งครั้งถ้าโมเดลตอบ JSON ไม่ถูกรูปแบบ
async function withRetry(task, tries = 2) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      return await task(i);
    } catch (error) {
      last = error;
      if (error.status) throw error;
    }
  }
  throw fail(502, "AI ตอบกลับไม่ถูกรูปแบบ ลองใหม่อีกครั้ง");
}

export async function ingest(store, ai, { id, title, text }) {
  const clean = normalizeText(text);
  const name = String(title ?? "").trim().slice(0, LIMITS.maxTitle) || "เอกสารไม่มีชื่อ";
  if (clean.length < LIMITS.minChars) throw fail(400, `เนื้อหาสั้นเกินไป ต้องมีอย่างน้อย ${LIMITS.minChars} ตัวอักษร`);
  if (clean.length > LIMITS.maxChars) {
    throw fail(400, `เนื้อหายาวเกินไป (${clean.length.toLocaleString()} ตัวอักษร) รับได้ไม่เกิน ${LIMITS.maxChars.toLocaleString()} ตัวอักษร`);
  }

  const chunks = chunkText(clean);
  const vectors = [];
  for (let i = 0; i < chunks.length; i += LIMITS.embedBatch) {
    const batch = chunks.slice(i, i + LIMITS.embedBatch);
    vectors.push(...(await ai.embed(batch.map((c) => c.text))));
  }
  if (vectors.length !== chunks.length) throw fail(502, "สร้าง embedding ไม่ครบ ลองใหม่อีกครั้ง");

  const meta = {
    id,
    title: name,
    chars: clean.length,
    chunks: chunks.length,
    createdAt: new Date().toISOString(),
  };
  store.saveDoc(
    meta,
    clean,
    chunks.map((c, i) => ({ index: c.index, text: c.text, vector: vectors[i] })),
  );
  return meta;
}

export function getDoc(store) {
  const meta = requireDoc(store);
  return { ...meta, text: store.getText(), hasSummary: Boolean(store.getCache("summary")) };
}

export async function summarize(store, ai, { refresh = false } = {}) {
  requireDoc(store);
  const cached = !refresh && store.getCache("summary");
  if (cached) return { ...cached, cached: true };

  const text = store.getText();
  let source = text;
  if (text.length > LIMITS.singleSummaryChars) {
    // เนื้อหายาว: สรุปทีละส่วนพร้อมกัน แล้วสรุปรวมจากประเด็นของทุกส่วน
    const groups = groupChunks(store.getChunks(), LIMITS.partChars);
    const parts = await Promise.all(
      groups.map((group, i) =>
        ai.chat(partialSummaryMessages(group.map((c) => c.text).join("\n"), i + 1, groups.length), { maxTokens: 700 }),
      ),
    );
    source = parts.flatMap((part) => bulletLines(part).map((line) => `- ${line}`)).join("\n");
  }

  const summary = await withRetry(async () =>
    cleanSummary(await ai.chat(summaryMessages(source), { json: true, maxTokens: 1500 })),
  );
  const result = { ...summary, createdAt: new Date().toISOString() };
  store.setCache("summary", result);
  return { ...result, cached: false };
}

// เลือกช่วงเนื้อหาแบบสุ่มสำหรับออกข้อสอบ เอกสารยาวจะได้ข้อสอบไม่ซ้ำเดิมทุกครั้ง
export function pickQuizText(chunks, windowChars, random = Math.random) {
  const all = chunks.map((c) => c.text).join("\n");
  if (all.length <= windowChars) return all;
  const groups = groupChunks(chunks, windowChars);
  const group = groups[Math.floor(random() * groups.length)];
  return group.map((c) => c.text).join("\n");
}

export async function makeQuiz(store, ai, { count = 5, level = "medium" } = {}) {
  requireDoc(store);
  const n = LIMITS.quizCounts.includes(Number(count)) ? Number(count) : 5;
  const lvl = LEVELS[level] ? level : "medium";
  const text = pickQuizText(store.getChunks(), LIMITS.quizWindowChars);
  const questions = await withRetry(async () =>
    cleanQuiz(await ai.chat(quizMessages(text, n, lvl), { json: true, maxTokens: 400 + n * 260 }), n),
  );
  return { level: lvl, questions };
}

export async function ask(store, ai, { question, history = [] } = {}) {
  requireDoc(store);
  const q = String(question ?? "").trim();
  if (!q) throw fail(400, "พิมพ์คำถามก่อน");
  if (q.length > LIMITS.maxQuestion) throw fail(400, `คำถามยาวเกินไป (ไม่เกิน ${LIMITS.maxQuestion} ตัวอักษร)`);

  const [queryVector] = await ai.embed([q]);
  const sources = topK(queryVector, store.getChunks(), 4);
  const answer = cleanAnswer(await ai.chat(askMessages(q, sources, Array.isArray(history) ? history : []), { maxTokens: 900 }));
  const cited = citedNumbers(answer, sources.length);

  return {
    answer: answer || "ไม่พบเรื่องนี้ในเนื้อหาที่ให้มา",
    sources: sources.map((s, i) => ({
      n: i + 1,
      index: s.index,
      score: Math.round(s.score * 100) / 100,
      text: s.text,
      cited: cited.includes(i + 1),
    })),
  };
}

export function remove(store) {
  requireDoc(store);
  store.clear();
  return { ok: true };
}
