// AI และ storage ปลอมสำหรับเทส ไม่ต้องต่อ Cloudflare และไม่เสียโควตา

// embedding ปลอม: นับตัวอักษรลง 64 ช่อง ข้อความที่มีคำซ้ำกันจะได้เวกเตอร์ใกล้กัน
export function fakeVector(text) {
  const v = new Array(64).fill(0);
  for (const ch of String(text)) v[ch.codePointAt(0) % 64] += 1;
  return v;
}

export function fakeAI(replies = {}) {
  const calls = { chat: [], embed: [] };
  return {
    calls,
    async embed(texts) {
      calls.embed.push(texts);
      return texts.map(fakeVector);
    },
    async chat(messages, options = {}) {
      calls.chat.push({ messages, options });
      const system = messages[0].content;
      const pick = (key, fallback) => {
        const reply = replies[key];
        if (Array.isArray(reply)) return reply.length > 1 ? reply.shift() : reply[0];
        return reply ?? fallback;
      };
      if (system.includes("สรุปเนื้อหาส่วนนี้")) return pick("partial", "- ประเด็นจากส่วนนี้\n- อีกประเด็นหนึ่ง");
      if (system.includes("สรุปเนื้อหาที่ได้รับ")) {
        return pick("summary", JSON.stringify({ overview: "ภาพรวม", points: ["ข้อ 1", "ข้อ 2"], terms: [{ term: "คำ", meaning: "ความหมาย" }] }));
      }
      if (system.includes("ออกข้อสอบปรนัย")) {
        return pick("quiz", JSON.stringify({ questions: [{ q: "ข้อใดถูก", choices: ["ก", "ข", "ค", "ง"], answer: 1, explain: "เพราะ ข" }] }));
      }
      return pick("ask", "คำตอบจากเนื้อหา [1]");
    },
  };
}

export function memoryStore() {
  let meta = null;
  let text = "";
  let chunks = [];
  const cache = new Map();
  return {
    getMeta: () => meta,
    getText: () => text,
    getChunks: () => chunks,
    saveDoc: (m, t, c) => {
      meta = m;
      text = t;
      chunks = c;
      cache.clear();
    },
    getCache: (k) => cache.get(k) ?? null,
    setCache: (k, v) => cache.set(k, v),
    clear: () => {
      meta = null;
      text = "";
      chunks = [];
      cache.clear();
    },
  };
}

export const LESSON = `การสังเคราะห์ด้วยแสง (Photosynthesis) เป็นกระบวนการที่พืชสีเขียวใช้พลังงานแสงเปลี่ยนคาร์บอนไดออกไซด์และน้ำให้เป็นน้ำตาลกลูโคส และปล่อยแก๊สออกซิเจนออกมา
เกิดขึ้นในคลอโรพลาสต์ ซึ่งมีรงควัตถุคลอโรฟิลล์ทำหน้าที่ดูดกลืนแสง

กระบวนการแบ่งเป็น 2 ขั้นตอน คือ ปฏิกิริยาที่ต้องใช้แสง (light reaction) เกิดที่ไทลาคอยด์ ได้ ATP และ NADPH
และวัฏจักรคัลวิน (Calvin cycle) เกิดที่สโตรมา ใช้ ATP และ NADPH ตรึงคาร์บอนไดออกไซด์เป็นน้ำตาล

ปัจจัยที่มีผลต่ออัตราการสังเคราะห์ด้วยแสง ได้แก่ ความเข้มแสง ความเข้มข้นของคาร์บอนไดออกไซด์ และอุณหภูมิ`;
