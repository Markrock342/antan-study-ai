// เส้นทาง /api/* แยกจาก worker.js เพื่อให้เทสได้บน Node ด้วย Durable Object ปลอม
import { LIMITS } from "./engine.js";

export const MAX_BODY_BYTES = 400_000;
const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

async function readBody(request) {
  const length = Number(request.headers.get("content-length") || 0);
  if (length > MAX_BODY_BYTES) return { error: json(413, { message: "ข้อมูลใหญ่เกินไป" }) };
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return { error: json(413, { message: "ข้อมูลใหญ่เกินไป" }) };
  if (!text) return { body: {} };
  try {
    return { body: JSON.parse(text) };
  } catch {
    return { error: json(400, { message: "ข้อมูลไม่ถูกต้อง" }) };
  }
}

async function callDoc(env, id, action, args) {
  const stub = env.DOCS.get(env.DOCS.idFromName(id));
  const { status, body } = await stub.call(action, args);
  return json(status, body);
}

export async function handleApi(request, env) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "");
  const method = request.method;

  if (path === "/api/health" && method === "GET") {
    return json(200, { ok: true, service: "antan-study-ai", limits: { maxChars: LIMITS.maxChars, quizCounts: LIMITS.quizCounts } });
  }

  if (path === "/api/docs" && method === "POST") {
    const { body, error } = await readBody(request);
    if (error) return error;
    const id = crypto.randomUUID();
    return callDoc(env, id, "ingest", { id, title: body.title, text: body.text });
  }

  const match = path.match(/^\/api\/docs\/([^/]+)(?:\/(summary|quiz|ask))?$/);
  if (match) {
    const [, id, action] = match;
    if (!ID_RE.test(id)) return json(404, { message: "ไม่พบเอกสารนี้" });
    if (!action && method === "GET") return callDoc(env, id, "get");
    if (!action && method === "DELETE") return callDoc(env, id, "delete");
    if (action && method === "POST") {
      const { body, error } = await readBody(request);
      if (error) return error;
      return callDoc(env, id, action, body);
    }
    return json(405, { message: "ไม่รองรับคำขอนี้" });
  }

  return json(404, { message: "ไม่พบ API นี้" });
}

