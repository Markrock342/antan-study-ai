import { test } from "node:test";
import assert from "node:assert/strict";
import { chunkText, groupChunks, normalizeText } from "../src/lib/chunk.js";
import { cosine, topK } from "../src/lib/retrieve.js";
import { citedNumbers, cleanAnswer, cleanQuiz, cleanSummary, extractJson, bulletLines, stripChoiceLabel } from "../src/lib/parse.js";
import { askMessages } from "../src/lib/prompts.js";

test("แบ่งท่อน: ข้อความว่างได้ 0 ท่อน ข้อความสั้นได้ 1 ท่อน", () => {
  assert.deepEqual(chunkText("   \n "), []);
  const one = chunkText("สวัสดีครับ นี่คือเนื้อหาสั้น ๆ");
  assert.equal(one.length, 1);
  assert.equal(one[0].text, "สวัสดีครับ นี่คือเนื้อหาสั้น ๆ");
});

test("แบ่งท่อน: ไม่เกินขนาด ครอบคลุมทั้งเอกสาร และมีส่วนซ้อนกัน", () => {
  const text = Array.from({ length: 120 }, (_, i) => `ประโยคที่ ${i} อธิบายเรื่องการสังเคราะห์ด้วยแสงของพืช`).join(" ");
  const chunks = chunkText(text, { size: 300, overlap: 60 });
  assert.ok(chunks.length > 5);
  assert.ok(chunks.every((c) => c.text.length <= 300));
  assert.equal(chunks[0].start, 0);
  assert.equal(chunks.at(-1).end, normalizeText(text).length);
  for (let i = 1; i < chunks.length; i++) {
    assert.ok(chunks[i].start < chunks[i - 1].end, "ท่อนถัดไปต้องเริ่มก่อนท่อนก่อนหน้าจบ (overlap)");
    assert.ok(chunks[i].start > chunks[i - 1].start, "ต้องเดินหน้าเสมอ");
  }
});

test("แบ่งท่อน: ภาษาไทยที่ไม่มีช่องว่างเลยก็ยังตัดได้", () => {
  const text = "ก".repeat(2000);
  const chunks = chunkText(text, { size: 500, overlap: 50 });
  assert.ok(chunks.length >= 4);
  assert.ok(chunks.every((c) => c.text.length <= 500));
});

test("รวมท่อนเป็นก้อนตามขนาด", () => {
  const chunks = [1, 2, 3, 4, 5].map((i) => ({ index: i, text: "x".repeat(400) }));
  const groups = groupChunks(chunks, 1000);
  assert.deepEqual(groups.map((g) => g.length), [2, 2, 1]);
});

test("cosine similarity", () => {
  assert.equal(cosine([1, 0], [1, 0]), 1);
  assert.equal(cosine([1, 0], [0, 1]), 0);
  assert.equal(cosine([0, 0], [1, 1]), 0);
});

test("topK: เลือกท่อนที่ใกล้ที่สุด ตัดท่อนที่ไม่เกี่ยว และเรียงตามลำดับเอกสาร", () => {
  const items = [
    { index: 0, text: "a", vector: [1, 0, 0] },
    { index: 1, text: "b", vector: [0, 1, 0] },
    { index: 2, text: "c", vector: [0.9, 0.1, 0] },
    { index: 3, text: "d", vector: [0, 0, 1] },
  ];
  const result = topK([1, 0, 0], items, 2);
  assert.deepEqual(result.map((r) => r.index), [0, 2]);
  assert.ok(result.every((r) => r.score > 0.9));
});

test("ดึง JSON จากคำตอบที่มีข้อความหรือ ``` ห่ออยู่", () => {
  assert.deepEqual(extractJson('นี่คือคำตอบ ```json\n{"a": "มี } ในข้อความ", "b": 2}\n``` จบ'), { a: "มี } ในข้อความ", b: 2 });
  assert.throws(() => extractJson("ไม่มี json"));
});

test("กรองข้อสอบที่ผิดรูปแบบทิ้ง เหลือแต่ข้อที่ใช้ได้", () => {
  const raw = JSON.stringify({
    questions: [
      { q: "ข้อดี", choices: ["1", "2", "3", "4"], answer: 2, explain: "x" },
      { q: "ตัวเลือกไม่ครบ", choices: ["1", "2", "3"], answer: 0 },
      { q: "คำตอบเกินช่วง", choices: ["1", "2", "3", "4"], answer: 4 },
      { q: "ตัวเลือกซ้ำ", choices: ["1", "1", "3", "4"], answer: 0 },
      { q: "ข้อดี", choices: ["5", "6", "7", "8"], answer: 0 },
      { question: "ใช้ชื่อฟิลด์ question", choices: ["ก", "ข", "ค", "ง"], answer: "3" },
    ],
  });
  const quiz = cleanQuiz(raw);
  assert.deepEqual(quiz.map((q) => q.q), ["ข้อดี", "ใช้ชื่อฟิลด์ question"]);
  assert.equal(quiz[1].answer, 3);
  assert.throws(() => cleanQuiz('{"questions": []}'));
});

test("สรุป: ทำความสะอาดข้อมูลและปฏิเสธสรุปว่าง", () => {
  const s = cleanSummary('{"overview":" ภาพรวม ","points":["ก", "", 3],"terms":[{"term":"A","meaning":"B"},{"term":"ไม่มีความหมาย"}]}');
  assert.deepEqual(s, { overview: "ภาพรวม", points: ["ก"], terms: [{ term: "A", meaning: "B" }] });
  assert.throws(() => cleanSummary('{"overview":"","points":[]}'));
});

test("อ่านรายการ bullet และเลขอ้างอิงในคำตอบ", () => {
  assert.deepEqual(bulletLines("- หนึ่งข้อ\n* สองข้อ\n1. สามข้อ\n\n-"), ["หนึ่งข้อ", "สองข้อ", "สามข้อ"]);
  assert.deepEqual(citedNumbers("ตาม [2] และ [1][2] แต่ [9] ไม่มี", 4), [1, 2]);
});

test("prompt ถาม-ตอบ ใส่แหล่งอ้างอิงเป็นเลข และเก็บประวัติแค่ 4 ข้อความล่าสุด", () => {
  const history = Array.from({ length: 6 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: `ข้อความ ${i}` }));
  const messages = askMessages("คำถาม", [{ text: "แหล่งแรก" }, { text: "แหล่งสอง" }], history);
  assert.match(messages[0].content, /\[1\] แหล่งแรก/);
  assert.match(messages[0].content, /\[2\] แหล่งสอง/);
  assert.equal(messages.length, 1 + 4 + 1);
  assert.equal(messages.at(-1).content, "คำถาม");
});

test("ตัด ก. ข. A) นำหน้าตัวเลือก และบรรทัดทวนคำถามในคำตอบ", () => {
  assert.equal(stripChoiceLabel("ค. สีแดงและสีน้ำเงิน"), "สีแดงและสีน้ำเงิน");
  assert.equal(stripChoiceLabel("B) ATP"), "ATP");
  assert.equal(stripChoiceLabel("2. น้ำ"), "น้ำ");
  assert.equal(stripChoiceLabel("ATP และ NADPH"), "ATP และ NADPH");
  assert.equal(cleanAnswer("คำถาม: เมืองหลวงคืออะไร\n\nไม่พบเรื่องนี้ในเนื้อหา"), "ไม่พบเรื่องนี้ในเนื้อหา");
  assert.equal(cleanAnswer("คำตอบ: กรดแลกติก [3]"), "กรดแลกติก [3]");
});
