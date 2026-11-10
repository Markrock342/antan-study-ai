// แบ่งเนื้อหายาวเป็นท่อน ๆ (chunk) สำหรับทำ embedding และค้นหา
// ภาษาไทยไม่เว้นวรรคระหว่างคำ จึงตัดที่ขึ้นบรรทัดใหม่ก่อน แล้วค่อยตัดที่ช่องว่าง (ท้ายประโยค/วลี)

export const CHUNK_SIZE = 700;
export const CHUNK_OVERLAP = 120;

export function normalizeText(text) {
  return String(text ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\t\f\v ]+/g, " ")
    .replace(/[ ]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// หาจุดตัดที่ดีที่สุดไม่เกิน limit: ย่อหน้า > บรรทัด > ช่องว่าง > ตัดตรง ๆ
function cutPoint(text, limit) {
  if (text.length <= limit) return text.length;
  const window = text.slice(0, limit);
  const minimum = Math.floor(limit * 0.5);
  for (const sep of ["\n\n", "\n", " "]) {
    const at = window.lastIndexOf(sep);
    if (at >= minimum) return at + sep.length;
  }
  return limit;
}

export function chunkText(text, { size = CHUNK_SIZE, overlap = CHUNK_OVERLAP } = {}) {
  const clean = normalizeText(text);
  if (!clean) return [];
  const chunks = [];
  let start = 0;
  while (start < clean.length) {
    const end = start + cutPoint(clean.slice(start), size);
    const piece = clean.slice(start, end).trim();
    if (piece) chunks.push({ index: chunks.length, start, end, text: piece });
    if (end >= clean.length) break;
    // ถอยกลับเล็กน้อยให้ท่อนถัดไปมีบริบทซ้อนกัน แต่ต้องเดินหน้าเสมอ
    // ให้ท่อนใหม่เริ่มที่ต้นคำ: ช่องว่างแรกหลังจุดถอยกลับ
    let next = end - overlap;
    const space = clean.indexOf(" ", next);
    if (space >= next && space < end - 1) next = space + 1;
    start = Math.max(next, start + 1);
  }
  return chunks;
}

// รวมท่อนติดกันเป็นก้อนใหญ่ไม่เกิน limit ตัวอักษร (ใช้ตอนสรุปเนื้อหายาว)
export function groupChunks(chunks, limit) {
  const groups = [];
  let current = [];
  let length = 0;
  for (const chunk of chunks) {
    if (current.length && length + chunk.text.length > limit) {
      groups.push(current);
      current = [];
      length = 0;
    }
    current.push(chunk);
    length += chunk.text.length;
  }
  if (current.length) groups.push(current);
  return groups;
}
