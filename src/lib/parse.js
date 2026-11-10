// แปลงคำตอบของโมเดลให้เป็นข้อมูลที่เชื่อถือได้ก่อนส่งให้หน้าเว็บ

// ดึง JSON ก้อนแรกออกจากข้อความ (โมเดลบางทีห่อด้วย ```json หรือพูดนำหน้า)
export function extractJson(raw) {
  if (raw && typeof raw === "object") return raw;
  const text = String(raw ?? "").replace(/```(?:json)?/gi, "");
  const start = text.indexOf("{");
  if (start < 0) throw new Error("no json");
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) return JSON.parse(text.slice(start, i + 1));
  }
  throw new Error("unterminated json");
}

const str = (value, max) => (typeof value === "string" ? value.trim().slice(0, max) : "");

export function cleanSummary(raw) {
  const data = extractJson(raw);
  const points = (Array.isArray(data.points) ? data.points : [])
    .map((p) => str(p, 500))
    .filter(Boolean)
    .slice(0, 10);
  const terms = (Array.isArray(data.terms) ? data.terms : [])
    .map((t) => ({ term: str(t?.term, 80), meaning: str(t?.meaning, 300) }))
    .filter((t) => t.term && t.meaning)
    .slice(0, 10);
  const overview = str(data.overview, 1200);
  if (!overview && !points.length) throw new Error("empty summary");
  return { overview, points, terms };
}

// โมเดลบางครั้งใส่ "ก." "ข)" "A." นำหน้าตัวเลือก หน้าเว็บใส่ให้เองแล้ว จึงตัดออก
export function stripChoiceLabel(choice) {
  return choice.replace(/^\s*(?:[ก-ง]|[A-Da-d]|[1-4])\s*[.)．:]\s*/, "").trim();
}

// ตัดบรรทัด "คำถาม: ..." ที่โมเดลทวนไว้หน้าคำตอบ
export function cleanAnswer(answer) {
  return String(answer ?? "")
    .replace(/^\s*(?:คำถาม|Q)\s*[:：][^\n]*\n+/i, "")
    .replace(/^\s*(?:คำตอบ|A)\s*[:：]\s*/i, "")
    .trim();
}

export function cleanQuiz(raw, max = 10) {
  const data = extractJson(raw);
  const list = Array.isArray(data.questions) ? data.questions : [];
  const seen = new Set();
  const questions = [];
  for (const item of list) {
    const q = str(item?.q ?? item?.question, 400);
    const choices = (Array.isArray(item?.choices) ? item.choices : []).map((c) => stripChoiceLabel(str(String(c ?? ""), 200)));
    const answer = Number(item?.answer);
    if (!q || seen.has(q)) continue;
    if (choices.length !== 4 || choices.some((c) => !c) || new Set(choices).size !== 4) continue;
    if (!Number.isInteger(answer) || answer < 0 || answer > 3) continue;
    seen.add(q);
    questions.push({ q, choices, answer, explain: str(item?.explain, 600) });
    if (questions.length >= max) break;
  }
  if (!questions.length) throw new Error("no valid questions");
  return questions;
}

// รายการ "- ..." จากการสรุปทีละส่วน
export function bulletLines(text) {
  return String(text ?? "")
    .split("\n")
    .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim())
    .filter((line) => line.length > 3);
}

// เลขอ้างอิง [n] ที่คำตอบใช้จริง
export function citedNumbers(answer, max) {
  const found = new Set();
  for (const match of String(answer ?? "").matchAll(/\[(\d{1,2})\]/g)) {
    const n = Number(match[1]);
    if (n >= 1 && n <= max) found.add(n);
  }
  return [...found].sort((a, b) => a - b);
}
