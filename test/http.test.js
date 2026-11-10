import { test } from "node:test";
import assert from "node:assert/strict";
import { handleApi } from "../src/lib/http.js";

// Durable Object ปลอม: จำว่าถูกเรียกด้วยอะไร
function fakeEnv() {
  const calls = [];
  return {
    calls,
    DOCS: {
      idFromName: (name) => name,
      get: (id) => ({
        call: async (action, args) => {
          calls.push({ id, action, args });
          return { status: action === "ingest" ? 201 : 200, body: { ok: true, action } };
        },
      }),
    },
  };
}

const UUID = "0b8f5e0e-7a51-4b8e-9c6f-2f0d7b1c9a10";
const req = (method, path, body) =>
  new Request(`https://example.com${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });

test("health ตอบพร้อมขีดจำกัด", async () => {
  const res = await handleApi(req("GET", "/api/health"), fakeEnv());
  assert.equal(res.status, 200);
  assert.equal((await res.json()).limits.maxChars, 60000);
});

test("สร้างเอกสารได้ id ใหม่แบบ UUID และส่งต่อให้ Durable Object", async () => {
  const env = fakeEnv();
  const res = await handleApi(req("POST", "/api/docs", { title: "t", text: "x" }), env);
  assert.equal(res.status, 201);
  assert.equal(env.calls[0].action, "ingest");
  assert.match(env.calls[0].args.id, /^[0-9a-f-]{36}$/);
  assert.equal(env.calls[0].id, env.calls[0].args.id);
});

test("ส่งคำสั่งไปยังเอกสารที่ถูกตัว", async () => {
  const env = fakeEnv();
  for (const [method, path, action] of [
    ["GET", `/api/docs/${UUID}`, "get"],
    ["DELETE", `/api/docs/${UUID}`, "delete"],
    ["POST", `/api/docs/${UUID}/summary`, "summary"],
    ["POST", `/api/docs/${UUID}/quiz`, "quiz"],
    ["POST", `/api/docs/${UUID}/ask`, "ask"],
  ]) {
    const res = await handleApi(req(method, path, method === "POST" ? {} : undefined), env);
    assert.equal(res.status, 200, path);
    assert.equal(env.calls.at(-1).action, action);
    assert.equal(env.calls.at(-1).id, UUID);
  }
});

test("ปฏิเสธ id แปลก JSON เสีย ข้อมูลใหญ่เกิน และเส้นทางที่ไม่มี", async () => {
  const env = fakeEnv();
  assert.equal((await handleApi(req("GET", "/api/docs/../../etc"), env)).status, 404);
  assert.equal((await handleApi(req("POST", "/api/docs", "{bad"), env)).status, 400);
  assert.equal((await handleApi(req("POST", "/api/docs", { text: "ก".repeat(500_000) }), env)).status, 413);
  assert.equal((await handleApi(req("GET", "/api/nope"), env)).status, 404);
  assert.equal((await handleApi(req("PUT", `/api/docs/${UUID}`), env)).status, 405);
  assert.equal(env.calls.length, 0);
});
