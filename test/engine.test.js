import { test } from "node:test";
import assert from "node:assert/strict";
import { ask, getDoc, ingest, makeQuiz, pickQuizText, remove, summarize, LIMITS } from "../src/lib/engine.js";
import { fakeAI, memoryStore, LESSON } from "./helpers.js";

const ID = "11111111-2222-3333-4444-555555555555";

async function loaded(text = LESSON, replies) {
  const store = memoryStore();
  const ai = fakeAI(replies);
  await ingest(store, ai, { id: ID, title: "ชีววิทยา บทที่ 3", text });
  return { store, ai };
}

test("รับเนื้อหา: แบ่งท่อน ทำ embedding ครบทุกท่อน และเก็บข้อมูล", async () => {
  const { store, ai } = await loaded();
  const doc = getDoc(store);
  assert.equal(doc.title, "ชีววิทยา บทที่ 3");
  assert.equal(doc.chunks, store.getChunks().length);
  assert.ok(store.getChunks().every((c) => c.vector.length === 64));
  assert.equal(ai.calls.embed.flat().length, doc.chunks);
  assert.equal(doc.hasSummary, false);
});

test("รับเนื้อหา: ปฏิเสธเนื้อหาสั้นหรือยาวเกิน", async () => {
  const store = memoryStore();
  await assert.rejects(ingest(store, fakeAI(), { id: ID, text: "สั้นไป" }), { status: 400 });
  await assert.rejects(ingest(store, fakeAI(), { id: ID, text: "ก ".repeat(LIMITS.maxChars) }), { status: 400 });
});

test("สรุป: เก็บผลไว้ เรียกซ้ำไม่เสีย AI จนกว่าจะสั่งสรุปใหม่", async () => {
  const { store, ai } = await loaded();
  const first = await summarize(store, ai);
  const second = await summarize(store, ai);
  assert.equal(first.cached, false);
  assert.equal(second.cached, true);
  assert.equal(ai.calls.chat.length, 1);
  await summarize(store, ai, { refresh: true });
  assert.equal(ai.calls.chat.length, 2);
  assert.equal(getDoc(store).hasSummary, true);
});

test("สรุปเนื้อหายาว: สรุปทีละส่วนก่อน แล้วรวมเป็นสรุปเดียว", async () => {
  const long = Array.from({ length: 40 }, (_, i) => `หัวข้อ ${i}: ${LESSON.slice(0, 400)}`).join("\n\n");
  const { store, ai } = await loaded(long);
  const result = await summarize(store, ai);
  const partial = ai.calls.chat.filter((c) => c.messages[0].content.includes("สรุปเนื้อหาส่วนนี้"));
  assert.ok(partial.length >= 2, "ต้องแบ่งสรุปหลายส่วน");
  assert.equal(ai.calls.chat.length, partial.length + 1);
  assert.deepEqual(result.points, ["ข้อ 1", "ข้อ 2"]);
});

test("ข้อสอบ: โมเดลตอบ JSON เสียครั้งแรก ระบบลองใหม่เองแล้วได้ข้อสอบ", async () => {
  const good = JSON.stringify({ questions: [{ q: "คลอโรฟิลล์อยู่ที่ใด", choices: ["คลอโรพลาสต์", "ไมโทคอนเดรีย", "นิวเคลียส", "ผนังเซลล์"], answer: 0, explain: "ตามเนื้อหา" }] });
  const { store, ai } = await loaded(LESSON, { quiz: ["ขอโทษครับ ตอบไม่ได้", good] });
  const result = await makeQuiz(store, ai, { count: 5, level: "hard" });
  assert.equal(result.level, "hard");
  assert.equal(result.questions[0].answer, 0);
  assert.equal(ai.calls.chat.length, 2);
});

test("ข้อสอบ: จำนวนข้อและระดับที่ไม่รองรับกลับเป็นค่าเริ่มต้น", async () => {
  const { store, ai } = await loaded();
  const result = await makeQuiz(store, ai, { count: 999, level: "god" });
  assert.equal(result.level, "medium");
  assert.match(ai.calls.chat[0].messages[1].content, /ออกข้อสอบ 5 ข้อ/);
});

test("ข้อสอบ: เอกสารยาวสุ่มเลือกช่วงเนื้อหาไม่เกินขนาดที่กำหนด", () => {
  const chunks = Array.from({ length: 30 }, (_, i) => ({ index: i, text: `ท่อน${i} `.repeat(80) }));
  const first = pickQuizText(chunks, 2000, () => 0);
  const last = pickQuizText(chunks, 2000, () => 0.99);
  assert.ok(first.length <= 2000 + 30);
  assert.notEqual(first, last);
  assert.match(first, /ท่อน0/);
});

test("ถาม-ตอบ: ค้นท่อนที่เกี่ยวข้อง ส่งเป็นแหล่งอ้างอิง และบอกว่าคำตอบอ้างแหล่งไหน", async () => {
  const { store, ai } = await loaded(LESSON + "\n\n" + "เรื่องอื่นที่ไม่เกี่ยว ".repeat(60));
  const result = await ask(store, ai, { question: "วัฏจักรคัลวินเกิดที่ไหน" });
  assert.equal(result.answer, "คำตอบจากเนื้อหา [1]");
  assert.ok(result.sources.length >= 1);
  assert.equal(result.sources[0].n, 1);
  assert.equal(result.sources[0].cited, true);
  const prompt = ai.calls.chat[0].messages[0].content;
  assert.match(prompt, /\[1\]/);
});

test("ถาม-ตอบ: คำถามว่างหรือยาวเกินถูกปฏิเสธ", async () => {
  const { store, ai } = await loaded();
  await assert.rejects(ask(store, ai, { question: "  " }), { status: 400 });
  await assert.rejects(ask(store, ai, { question: "ก".repeat(LIMITS.maxQuestion + 1) }), { status: 400 });
});

test("ลบเอกสารแล้วเรียกใช้ต่อได้ 404", async () => {
  const { store, ai } = await loaded();
  remove(store);
  assert.throws(() => getDoc(store), { status: 404 });
  await assert.rejects(summarize(store, ai), { status: 404 });
});
