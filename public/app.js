// อ่านทัน — หน้าเว็บฝั่งผู้ใช้ (ไม่มีเฟรมเวิร์ก)

const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];

const MAX_CHARS = 60000;
const MIN_CHARS = 150;
const LIST_KEY = "antan-docs";
const PDFJS = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174";

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ESC[c]);
const fmt = (n) => Number(n || 0).toLocaleString("th-TH");
const dateText = (iso) => new Date(iso).toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "2-digit" });

/* ---------- ทั่วไป ---------- */

async function api(path, { method = "GET", body } = {}) {
  let res;
  try {
    res = await fetch(path, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw Object.assign(new Error("เชื่อมต่ออินเทอร์เน็ตไม่ได้ ลองใหม่อีกครั้ง"), { status: 0 });
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.message || "เกิดข้อผิดพลาด ลองใหม่อีกครั้ง"), { status: res.status });
  return data;
}

let toastTimer;
function toast(message) {
  const el = $("#toast");
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2800);
}

function busy(button, on, label) {
  if (on) {
    button.dataset.label = button.textContent;
    button.textContent = label;
  } else if (button.dataset.label) {
    button.textContent = button.dataset.label;
  }
  button.disabled = on;
  button.toggleAttribute("aria-busy", on);
}

function thinking(title, hint) {
  return `<div class="thinking"><p>${esc(title)}</p>${hint ? `<small>${esc(hint)}</small>` : ""}
    <div class="bar"></div><div class="bar"></div><div class="bar"></div></div>`;
}

function failBox(message, retryId) {
  return `<div class="fail" role="alert"><b>${esc(message)}</b>
    ${retryId ? `<button type="button" class="btn btn-outline btn-sm" id="${retryId}">ลองอีกครั้ง</button>` : ""}</div>`;
}

function confirmDialog(title, text) {
  const dialog = $("#confirm");
  $("#confirm-title").textContent = title;
  $("#confirm-text").textContent = text;
  dialog.showModal();
  return new Promise((resolve) => {
    dialog.addEventListener("close", () => resolve(dialog.returnValue === "ok"), { once: true });
  });
}

/* ---------- รายการเอกสารในเครื่อง ---------- */

function readList() {
  try {
    const list = JSON.parse(localStorage.getItem(LIST_KEY) || "[]");
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}
function writeList(list) {
  try {
    localStorage.setItem(LIST_KEY, JSON.stringify(list.slice(0, 50)));
  } catch {}
}
function rememberDoc(meta) {
  const list = readList().filter((d) => d.id !== meta.id);
  list.unshift({ id: meta.id, title: meta.title, chars: meta.chars, createdAt: meta.createdAt });
  writeList(list);
}
function forgetDoc(id) {
  writeList(readList().filter((d) => d.id !== id));
  try {
    sessionStorage.removeItem(`antan-chat-${id}`);
  } catch {}
}

/* ---------- หน้าแรก ---------- */

const home = {
  mode: "paste",
  fileText: "",
  fileName: "",
};

function currentText() {
  return home.mode === "paste" ? $("#doc-text").value : home.fileText;
}

function updateCounter() {
  const n = currentText().trim().length;
  const el = $("#counter");
  el.textContent = `${fmt(n)} / ${fmt(MAX_CHARS)} ตัวอักษร`;
  el.classList.toggle("is-over", n > MAX_CHARS);
}

function setMode(mode) {
  home.mode = mode;
  $$("#add-form .seg [data-mode]").forEach((b) => {
    const on = b.dataset.mode === mode;
    b.setAttribute("aria-selected", String(on));
    b.tabIndex = on ? 0 : -1;
  });
  $("#mode-paste").hidden = mode !== "paste";
  $("#mode-file").hidden = mode !== "file";
  $("#add-error").textContent = "";
  updateCounter();
}

function renderDocList() {
  const list = readList();
  $("#doc-list").innerHTML = list
    .map(
      (d) => `<li class="doc-item">
        <a href="#/d/${esc(d.id)}"><b>${esc(d.title)}</b><small>${fmt(d.chars)} ตัวอักษร · ${dateText(d.createdAt)}</small></a>
        <button type="button" class="icon-btn" data-remove="${esc(d.id)}" aria-label="ลบ ${esc(d.title)}" title="ลบ">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" /></svg>
        </button>
      </li>`,
    )
    .join("");
  $("#doc-list-empty").hidden = list.length > 0;
  $("#my-docs-link").textContent = list.length ? `เอกสารของฉัน (${list.length})` : "เอกสารของฉัน";
}

let pdfjsPromise;
function loadPdfJs() {
  pdfjsPromise ||= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = `${PDFJS}/pdf.min.js`;
    s.onload = () => {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = `${PDFJS}/pdf.worker.min.js`;
      resolve(window.pdfjsLib);
    };
    s.onerror = () => reject(new Error("โหลดตัวอ่าน PDF ไม่สำเร็จ"));
    document.head.append(s);
  });
  return pdfjsPromise;
}

async function readPdf(file) {
  const pdfjs = await loadPdfJs();
  const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const pages = [];
  for (let p = 1; p <= Math.min(pdf.numPages, 150); p++) {
    const content = await (await pdf.getPage(p)).getTextContent();
    pages.push(content.items.map((item) => item.str + (item.hasEOL ? "\n" : "")).join(""));
  }
  return pages.join("\n\n");
}

async function handleFile(file) {
  const info = $("#file-info");
  info.hidden = false;
  info.classList.remove("is-error");
  info.textContent = `กำลังอ่าน ${file.name}…`;
  home.fileText = "";
  try {
    const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
    if (!isPdf && !/\.(txt|md)$/i.test(file.name) && !file.type.startsWith("text/")) {
      throw new Error("รองรับเฉพาะไฟล์ PDF, TXT และ MD");
    }
    const text = isPdf ? await readPdf(file) : await file.text();
    if (text.trim().length < MIN_CHARS) {
      throw new Error(isPdf ? "อ่านข้อความจาก PDF ไม่ได้ ไฟล์อาจเป็นภาพสแกน ลองคัดลอกข้อความมาวางแทน" : "ไฟล์นี้มีข้อความน้อยเกินไป");
    }
    home.fileText = text;
    home.fileName = file.name;
    info.textContent = `✓ ${file.name} — อ่านได้ ${fmt(text.trim().length)} ตัวอักษร`;
    if (!$("#doc-title").value.trim()) $("#doc-title").value = file.name.replace(/\.[^.]+$/, "");
  } catch (error) {
    info.classList.add("is-error");
    info.textContent = error.message || "อ่านไฟล์ไม่สำเร็จ";
  }
  updateCounter();
}

$$("#add-form .seg [data-mode]").forEach((b) => b.addEventListener("click", () => setMode(b.dataset.mode)));
$("#doc-text").addEventListener("input", updateCounter);
$("#file").addEventListener("change", (e) => e.target.files[0] && handleFile(e.target.files[0]));
const drop = $("#drop");
["dragenter", "dragover"].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add("is-over"); }));
["dragleave", "drop"].forEach((t) => drop.addEventListener(t, () => drop.classList.remove("is-over")));
drop.addEventListener("drop", (e) => {
  e.preventDefault();
  const file = e.dataTransfer?.files?.[0];
  if (file) handleFile(file);
});

$("#sample").addEventListener("click", async () => {
  setMode("paste");
  const res = await fetch("/sample.txt");
  $("#doc-title").value = "ชีววิทยา: การสังเคราะห์ด้วยแสงและการหายใจระดับเซลล์";
  $("#doc-text").value = await res.text();
  updateCounter();
  $("#add-submit").focus();
});

$("#add-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const error = $("#add-error");
  error.textContent = "";
  const text = currentText().trim();
  if (text.length < MIN_CHARS) {
    error.textContent = home.mode === "paste" ? `วางเนื้อหาอย่างน้อย ${MIN_CHARS} ตัวอักษร` : "เลือกไฟล์ก่อน";
    return;
  }
  if (text.length > MAX_CHARS) {
    error.textContent = `เนื้อหายาวเกิน ${fmt(MAX_CHARS)} ตัวอักษร ลองแบ่งเป็นหลายเอกสาร`;
    return;
  }
  const button = $("#add-submit");
  busy(button, true, "กำลังอ่านและจัดเก็บเนื้อหา…");
  try {
    const meta = await api("/api/docs", { method: "POST", body: { title: $("#doc-title").value, text } });
    rememberDoc(meta);
    $("#add-form").reset();
    home.fileText = "";
    $("#file-info").hidden = true;
    updateCounter();
    location.hash = `#/d/${meta.id}/summary`;
  } catch (e) {
    error.textContent = e.message;
  } finally {
    busy(button, false);
  }
});

$("#doc-list").addEventListener("click", async (e) => {
  const button = e.target.closest("[data-remove]");
  if (!button) return;
  const id = button.dataset.remove;
  const doc = readList().find((d) => d.id === id);
  if (!(await confirmDialog(`ลบ “${doc?.title || "เอกสาร"}”?`, "สรุป ข้อสอบ และประวัติคำถามของเอกสารนี้จะหายไปด้วย"))) return;
  await api(`/api/docs/${id}`, { method: "DELETE" }).catch(() => {});
  forgetDoc(id);
  renderDocList();
  toast("ลบเอกสารแล้ว");
});

/* ---------- หน้าเอกสาร ---------- */

const doc = {
  id: null,
  meta: null,
  summary: null,
  quiz: null,
  chat: [],
  tab: "summary",
  setup: { count: 5, level: "medium" },
};

function chatKey() {
  return `antan-chat-${doc.id}`;
}
function saveChat() {
  try {
    sessionStorage.setItem(chatKey(), JSON.stringify(doc.chat.slice(-30)));
  } catch {}
}

async function openDoc(id, tab) {
  if (doc.id !== id) {
    Object.assign(doc, { id, meta: null, summary: null, quiz: null, tab: "summary" });
    try {
      doc.chat = JSON.parse(sessionStorage.getItem(`antan-chat-${id}`) || "[]");
    } catch {
      doc.chat = [];
    }
    $("#doc-name").textContent = readList().find((d) => d.id === id)?.title || "กำลังโหลด…";
    $("#doc-meta").textContent = "";
    $("#summary-body").innerHTML = "";
    $("#quiz-run").innerHTML = "";
    $("#quiz-setup").hidden = false;
    $("#source").textContent = "";
    renderChat();
    try {
      doc.meta = await api(`/api/docs/${id}`);
    } catch (e) {
      if (e.status === 404) {
        forgetDoc(id);
        show("missing");
        return;
      }
      $("#summary-body").innerHTML = failBox(e.message);
      showTab(tab || "summary");
      return;
    }
    rememberDoc(doc.meta);
    $("#doc-name").textContent = doc.meta.title;
    $("#doc-meta").textContent = `${fmt(doc.meta.chars)} ตัวอักษร · แบ่งเป็น ${fmt(doc.meta.chunks)} ส่วน · เพิ่มเมื่อ ${dateText(doc.meta.createdAt)}`;
    document.title = `${doc.meta.title} — อ่านทัน`;
    renderSource();
  }
  showTab(tab || doc.tab);
}

function showTab(tab) {
  if (!["summary", "quiz", "ask", "source"].includes(tab)) tab = "summary";
  doc.tab = tab;
  $$("#tabs [role=tab]").forEach((t) => {
    const on = t.dataset.tab === tab;
    t.setAttribute("aria-selected", String(on));
    t.tabIndex = on ? 0 : -1;
  });
  for (const name of ["summary", "quiz", "ask", "source"]) $(`#panel-${name}`).hidden = name !== tab;
  const wanted = `#/d/${doc.id}/${tab}`;
  if (location.hash !== wanted) history.replaceState(null, "", wanted);
  if (tab === "summary" && doc.meta && !doc.summary) loadSummary();
  if (tab === "ask") setTimeout(() => $("#ask-input").focus(), 0);
}

$("#tabs").addEventListener("click", (e) => {
  const tab = e.target.closest("[role=tab]");
  if (tab) showTab(tab.dataset.tab);
});
$("#tabs").addEventListener("keydown", (e) => {
  const tabs = $$("#tabs [role=tab]");
  const i = tabs.indexOf(document.activeElement);
  if (i < 0 || !["ArrowLeft", "ArrowRight"].includes(e.key)) return;
  e.preventDefault();
  const next = tabs[(i + (e.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length];
  next.focus();
  showTab(next.dataset.tab);
});

$("#doc-delete").addEventListener("click", async () => {
  if (!(await confirmDialog(`ลบ “${doc.meta?.title || "เอกสาร"}”?`, "สรุป ข้อสอบ และประวัติคำถามของเอกสารนี้จะหายไปด้วย"))) return;
  await api(`/api/docs/${doc.id}`, { method: "DELETE" }).catch(() => {});
  forgetDoc(doc.id);
  doc.id = null;
  toast("ลบเอกสารแล้ว");
  location.hash = "#/";
});

/* สรุป */

async function loadSummary(refresh = false) {
  const body = $("#summary-body");
  body.innerHTML = thinking("AI กำลังอ่านและสรุปเนื้อหา…", "ใช้เวลาประมาณ 5–30 วินาที ขึ้นกับความยาวของเนื้อหา");
  try {
    doc.summary = await api(`/api/docs/${doc.id}/summary`, { method: "POST", body: { refresh } });
    renderSummary();
  } catch (e) {
    body.innerHTML = failBox(e.message, "summary-retry");
    $("#summary-retry").addEventListener("click", () => loadSummary(refresh));
  }
}

function summaryText(s) {
  return [
    s.overview,
    "",
    "ประเด็นสำคัญ",
    ...s.points.map((p, i) => `${i + 1}. ${p}`),
    ...(s.terms.length ? ["", "คำศัพท์ที่ควรรู้", ...s.terms.map((t) => `- ${t.term}: ${t.meaning}`)] : []),
  ].join("\n");
}

function renderSummary() {
  const s = doc.summary;
  $("#summary-body").innerHTML = `<div class="summary">
    ${s.overview ? `<section><h2>ภาพรวม</h2><p class="overview">${esc(s.overview)}</p></section>` : ""}
    ${s.points.length ? `<section><h2>ประเด็นสำคัญ</h2><ol class="points">${s.points.map((p) => `<li>${esc(p)}</li>`).join("")}</ol></section>` : ""}
    ${s.terms.length ? `<section><h2>คำศัพท์ที่ควรรู้</h2><dl class="terms">${s.terms.map((t) => `<div><dt>${esc(t.term)}</dt><dd>${esc(t.meaning)}</dd></div>`).join("")}</dl></section>` : ""}
    <div class="summary-actions">
      <button type="button" class="btn btn-outline btn-sm" id="summary-copy">คัดลอกสรุป</button>
      <button type="button" class="btn btn-outline btn-sm" id="summary-refresh">สรุปใหม่</button>
      <button type="button" class="btn btn-primary btn-sm" id="summary-to-quiz">ทดสอบความเข้าใจ →</button>
    </div>
  </div>`;
  $("#summary-copy").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(summaryText(s));
      toast("คัดลอกสรุปแล้ว");
    } catch {
      toast("คัดลอกไม่สำเร็จ");
    }
  });
  $("#summary-refresh").addEventListener("click", () => loadSummary(true));
  $("#summary-to-quiz").addEventListener("click", () => showTab("quiz"));
}

/* แบบทดสอบ */

function bindRadios(groupId, key) {
  $(`#${groupId}`).addEventListener("click", (e) => {
    const b = e.target.closest("[role=radio]");
    if (!b) return;
    doc.setup[key] = key === "count" ? Number(b.dataset.value) : b.dataset.value;
    $$(`#${groupId} [role=radio]`).forEach((x) => x.setAttribute("aria-checked", String(x === b)));
  });
}
bindRadios("quiz-count", "count");
bindRadios("quiz-level", "level");

$("#quiz-make").addEventListener("click", makeQuiz);

async function makeQuiz() {
  const button = $("#quiz-make");
  $("#quiz-error").textContent = "";
  busy(button, true, "AI กำลังออกข้อสอบ…");
  $("#quiz-run").innerHTML = thinking("กำลังออกข้อสอบจากเนื้อหา…", "ประมาณ 5–20 วินาที");
  try {
    const result = await api(`/api/docs/${doc.id}/quiz`, { method: "POST", body: doc.setup });
    doc.quiz = { questions: result.questions, i: 0, picks: [] };
    $("#quiz-setup").hidden = true;
    renderQuestion();
  } catch (e) {
    $("#quiz-run").innerHTML = "";
    $("#quiz-error").textContent = e.message;
  } finally {
    busy(button, false);
  }
}

const KEYS = ["ก", "ข", "ค", "ง"];

function renderQuestion() {
  const { questions, i, picks } = doc.quiz;
  const q = questions[i];
  const picked = picks[i];
  const answered = picked !== undefined;
  $("#quiz-run").innerHTML = `<div class="q-card">
    <div class="q-top"><span>ข้อ ${i + 1} จาก ${questions.length}</span><span>ถูก ${picks.filter((p, k) => p === questions[k].answer).length} ข้อ</span></div>
    <div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="${questions.length}" aria-valuenow="${i + (answered ? 1 : 0)}">
      <span style="width:${((i + (answered ? 1 : 0)) / questions.length) * 100}%"></span></div>
    <h2 class="q-text">${esc(q.q)}</h2>
    <div class="choices">${q.choices
      .map((c, k) => {
        let cls = "";
        let verdict = "";
        if (answered && k === q.answer) { cls = " is-right"; verdict = "ถูก"; }
        else if (answered && k === picked) { cls = " is-wrong"; verdict = "ที่คุณเลือก"; }
        return `<button type="button" class="choice${cls}" data-pick="${k}" ${answered ? "disabled" : ""}>
          <span class="key">${KEYS[k]}</span><span>${esc(c)}</span>${verdict ? `<span class="verdict">${verdict}</span>` : ""}</button>`;
      })
      .join("")}</div>
    ${answered ? `<div class="explain"><b>${picked === q.answer ? "ถูกต้อง!" : `ยังไม่ถูก คำตอบคือ ${KEYS[q.answer]}`}</b>${esc(q.explain || "")}</div>
      <button type="button" class="btn btn-primary btn-lg q-next" id="q-next">${i + 1 < questions.length ? "ข้อต่อไป" : "ดูผลคะแนน"}</button>` : ""}
  </div>`;
  if (answered) $("#q-next").focus();
}

$("#quiz-run").addEventListener("click", (e) => {
  const pick = e.target.closest("[data-pick]");
  if (pick && doc.quiz) {
    doc.quiz.picks[doc.quiz.i] = Number(pick.dataset.pick);
    renderQuestion();
    return;
  }
  if (e.target.closest("#q-next")) {
    doc.quiz.i += 1;
    if (doc.quiz.i < doc.quiz.questions.length) renderQuestion();
    else renderResult();
    return;
  }
  if (e.target.closest("#quiz-again")) {
    doc.quiz.i = 0;
    doc.quiz.picks = [];
    renderQuestion();
    return;
  }
  if (e.target.closest("#quiz-new")) {
    doc.quiz = null;
    $("#quiz-run").innerHTML = "";
    $("#quiz-setup").hidden = false;
    $("#quiz-make").focus();
  }
});

function renderResult() {
  const { questions, picks } = doc.quiz;
  const score = picks.filter((p, k) => p === questions[k].answer).length;
  const ratio = score / questions.length;
  const message = ratio >= 0.8 ? "เยี่ยมมาก พร้อมสอบแล้ว" : ratio >= 0.5 ? "ดีแล้ว ทบทวนข้อที่ผิดอีกนิด" : "ลองอ่านสรุปอีกรอบ แล้วกลับมาทำใหม่";
  $("#quiz-run").innerHTML = `<div class="q-card result">
    <p class="score">${score}/${questions.length}</p>
    <h2>${message}</h2>
    <div class="result-actions">
      <button type="button" class="btn btn-outline" id="quiz-again">ทำชุดนี้อีกครั้ง</button>
      <button type="button" class="btn btn-primary" id="quiz-new">สร้างชุดใหม่</button>
    </div>
    <div class="review">${questions
      .map((q, k) => {
        const ok = picks[k] === q.answer;
        return `<div class="review-item${ok ? "" : " is-wrong"}">
          <b>${k + 1}. ${esc(q.q)}</b>
          <p><span class="tag ${ok ? "ok" : "bad"}">${ok ? "ถูก" : "ผิด"}</span> · คำตอบ: ${KEYS[q.answer]}. ${esc(q.choices[q.answer])}</p>
        </div>`;
      })
      .join("")}</div>
  </div>`;
}

/* ถามจากเนื้อหา */

const SUGGEST = ["เนื้อหานี้เกี่ยวกับอะไร", "อธิบายเรื่องที่สำคัญที่สุดให้เข้าใจง่าย", "มีอะไรที่มักออกสอบบ้าง"];

function inline(text, sourceCount) {
  return esc(text)
    .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
    .replace(/\[(\d{1,2})\]/g, (m, n) =>
      Number(n) >= 1 && Number(n) <= sourceCount ? `<button type="button" class="cite" data-cite="${n}" aria-label="ดูแหล่งที่ ${n}">${n}</button>` : m,
    );
}

// แปลงคำตอบแบบ markdown อย่างง่าย: ย่อหน้า, รายการ -, รายการ 1.
function renderAnswer(text, sourceCount) {
  const out = [];
  let list = null;
  const close = () => {
    if (list) out.push(`</${list}>`);
    list = null;
  };
  for (const raw of String(text).split("\n")) {
    const line = raw.trim();
    const bullet = line.match(/^[-*•]\s+(.*)$/);
    const number = line.match(/^\d+[.)]\s+(.*)$/);
    if (bullet || number) {
      const type = bullet ? "ul" : "ol";
      if (list !== type) {
        close();
        out.push(`<${type}>`);
        list = type;
      }
      out.push(`<li>${inline((bullet || number)[1], sourceCount)}</li>`);
    } else if (!line) {
      close();
    } else {
      close();
      out.push(`<p>${inline(line.replace(/^#+\s*/, ""), sourceCount)}</p>`);
    }
  }
  close();
  return out.join("");
}

function renderChat() {
  const chat = $("#chat");
  if (!doc.chat.length) {
    chat.innerHTML = `<div class="chat-empty"><p>ลองถามเกี่ยวกับเนื้อหานี้</p>
      <div class="chips">${SUGGEST.map((s) => `<button type="button" class="chip" data-suggest="${esc(s)}">${esc(s)}</button>`).join("")}</div></div>`;
    return;
  }
  chat.innerHTML = doc.chat
    .map((m, i) => {
      if (m.role === "user") return `<div class="msg msg-user">${esc(m.content)}</div>`;
      if (m.pending) return `<div class="msg msg-ai" aria-label="กำลังตอบ"><span class="typing"><i></i><i></i><i></i></span></div>`;
      if (m.error) return `<div class="msg msg-ai is-error">${esc(m.content)}</div>`;
      const sources = m.sources || [];
      return `<div class="msg msg-ai" data-msg="${i}">
        <div class="answer">${renderAnswer(m.content, sources.length)}</div>
        ${sources.length ? `<div class="sources"><p>ที่มาจากเนื้อหา</p><ul>${sources
          .map((s) => `<li><button type="button" class="source-btn${s.cited ? " is-cited" : ""}" data-cite="${s.n}">
              <span class="cite" aria-hidden="true">${s.n}</span><span>${esc(s.text)}</span></button></li>`)
          .join("")}</ul></div>` : ""}
      </div>`;
    })
    .join("");
}

async function sendQuestion(question) {
  const q = question.trim();
  if (!q) return;
  const history = doc.chat.filter((m) => !m.pending && !m.error).map((m) => ({ role: m.role, content: m.content }));
  doc.chat.push({ role: "user", content: q }, { role: "assistant", pending: true });
  renderChat();
  $("#ask-input").value = "";
  autoGrow();
  const send = $("#ask-send");
  busy(send, true, "…");
  try {
    const result = await api(`/api/docs/${doc.id}/ask`, { method: "POST", body: { question: q, history } });
    doc.chat[doc.chat.length - 1] = { role: "assistant", content: result.answer, sources: result.sources };
  } catch (e) {
    doc.chat[doc.chat.length - 1] = { role: "assistant", error: true, content: e.message };
  } finally {
    busy(send, false);
  }
  saveChat();
  renderChat();
  $("#chat .msg:last-child")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  $("#ask-input").focus();
}

function autoGrow() {
  const input = $("#ask-input");
  input.style.height = "auto";
  input.style.height = `${Math.min(input.scrollHeight, 160)}px`;
}

$("#ask-form").addEventListener("submit", (e) => {
  e.preventDefault();
  sendQuestion($("#ask-input").value);
});
$("#ask-input").addEventListener("input", autoGrow);
$("#ask-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    sendQuestion($("#ask-input").value);
  }
});

$("#chat").addEventListener("click", (e) => {
  const suggest = e.target.closest("[data-suggest]");
  if (suggest) {
    sendQuestion(suggest.dataset.suggest);
    return;
  }
  const cite = e.target.closest("[data-cite]");
  if (cite) {
    const msg = doc.chat[Number(cite.closest("[data-msg]")?.dataset.msg)];
    const source = msg?.sources?.find((s) => s.n === Number(cite.dataset.cite));
    if (source) {
      renderSource(source.text);
      showTab("source");
      $("#source mark")?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }
});

/* ต้นฉบับ */

function renderSource(highlight) {
  const el = $("#source");
  const text = doc.meta?.text || "";
  const at = highlight ? text.indexOf(highlight) : -1;
  if (at < 0) {
    el.textContent = text;
    return;
  }
  el.innerHTML = `${esc(text.slice(0, at))}<mark>${esc(highlight)}</mark>${esc(text.slice(at + highlight.length))}`;
}

/* ---------- เส้นทาง ---------- */

function show(view) {
  for (const v of ["home", "doc", "missing"]) $(`#view-${v}`).hidden = v !== view;
}

function route() {
  const match = location.hash.match(/^#\/d\/([0-9a-f-]{36})(?:\/(\w+))?/);
  if (match) {
    show("doc");
    openDoc(match[1], match[2]);
  } else {
    document.title = "อ่านทัน — ผู้ช่วยอ่านหนังสือด้วย AI";
    show("home");
    renderDocList();
    updateCounter();
  }
  window.scrollTo(0, 0);
}

window.addEventListener("hashchange", route);
route();
