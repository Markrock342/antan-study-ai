// ค้นหาท่อนเนื้อหาที่เกี่ยวข้องกับคำถามด้วย cosine similarity ของ embedding

export function cosine(a, b) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (!na || !nb) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

// items: [{ index, text, vector }] → k ท่อนที่ใกล้คำถามที่สุด เรียงตามลำดับในเอกสาร
export function topK(queryVector, items, k = 4, minScore = 0.2) {
  return items
    .map((item) => ({ ...item, score: cosine(queryVector, item.vector) }))
    .filter((item) => item.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .sort((a, b) => a.index - b.index);
}
