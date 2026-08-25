/**
 * Mohan Order Creater
 * Chat-style PWA: parse PO (any format) via Gemini → match master/rules → Code | Qty | PO Name
 * API key stored only in localStorage (never in repo).
 */

const STORAGE = {
  apiKey: "moc_api_key",
  model: "moc_model",
  rules: "moc_rules_v1",
  master: "moc_master_v1",
};

const DEPRECATED_MODELS = {
  "gemini-2.0-flash": "gemini-3.6-flash",
  "gemini-1.5-flash": "gemini-3.6-flash",
  "gemini-1.5-flash-latest": "gemini-3.6-flash",
  "gemini-2.0-flash-001": "gemini-3.6-flash",
};

function resolveModel(saved) {
  const m = (saved || "").trim() || "gemini-3.6-flash";
  return DEPRECATED_MODELS[m] || m;
}

const state = {
  apiKey: localStorage.getItem(STORAGE.apiKey) || "",
  model: resolveModel(localStorage.getItem(STORAGE.model)),
  master: [], // {code, name, min_qty, case_qty}
  rules: loadRules(),
  pendingFiles: [],
  activeOrderId: null,
  orders: new Map(), // id -> { rows, meta }
  confirmResolver: null,
};

// Persist migrated model so old devices stop calling retired names
try {
  localStorage.setItem(STORAGE.model, state.model);
} catch (_) {}

// ---------- DOM ----------
const chatEl = document.getElementById("chat");
const msgInput = document.getElementById("msgInput");
const fileInput = document.getElementById("fileInput");
const attachPreview = document.getElementById("attachPreview");
const btnSend = document.getElementById("btnSend");
const btnNewOrder = document.getElementById("btnNewOrder");
const btnSettings = document.getElementById("btnSettings");
const settingsModal = document.getElementById("settingsModal");
const confirmModal = document.getElementById("confirmModal");
const confirmBody = document.getElementById("confirmBody");

// ---------- Init ----------
init();

async function init() {
  setupPdfJs();
  bindUi();
  setupMobileViewport();
  await loadMaster();
  updateSettingsLabels();
  showWelcome();
  if (!state.apiKey) {
    setTimeout(() => openSettings(), 400);
  }
  if ("serviceWorker" in navigator) {
    try {
      await navigator.serviceWorker.register("./sw.js");
    } catch (_) {}
  }
}

/** Keep ChatGPT-like fixed shell when mobile keyboard opens */
function setupMobileViewport() {
  const app = document.getElementById("app");
  if (!app) return;

  const apply = () => {
    try {
      if (window.visualViewport) {
        const vv = window.visualViewport;
        // Height of visible area (excludes keyboard)
        const h = Math.round(vv.height);
        app.style.height = h + "px";
        app.style.top = Math.round(vv.offsetTop) + "px";
      } else {
        app.style.height = window.innerHeight + "px";
        app.style.top = "0px";
      }
    } catch (_) {}
    scrollChat();
  };

  apply();
  window.addEventListener("resize", apply);
  window.visualViewport?.addEventListener("resize", apply);
  window.visualViewport?.addEventListener("scroll", apply);
  msgInput?.addEventListener("focus", () => setTimeout(apply, 50));
  msgInput?.addEventListener("blur", () => setTimeout(apply, 50));
}

function setupPdfJs() {
  if (window.pdfjsLib) {
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js";
  }
}

function bindUi() {
  btnSend.addEventListener("click", onSend);
  btnNewOrder.addEventListener("click", newOrder);
  btnSettings.addEventListener("click", openSettings);
  document.getElementById("btnCloseSettings").addEventListener("click", closeSettings);
  document.getElementById("btnSaveSettings").addEventListener("click", saveSettings);
  document.getElementById("btnToggleKey").addEventListener("click", () => {
    const inp = document.getElementById("apiKeyInput");
    const btn = document.getElementById("btnToggleKey");
    if (inp.type === "password") {
      inp.type = "text";
      btn.textContent = "Hide";
    } else {
      inp.type = "password";
      btn.textContent = "Show";
    }
  });
  document.getElementById("masterFileInput").addEventListener("change", onMasterUpload);
  document.getElementById("btnExportRules").addEventListener("click", exportRules);
  document.getElementById("importRulesInput").addEventListener("change", importRules);
  document.getElementById("btnClearRules").addEventListener("click", clearRules);
  document.getElementById("btnConfirmYes").addEventListener("click", () => finishConfirm(true));
  document.getElementById("btnConfirmNo").addEventListener("click", () => finishConfirm(false));

  fileInput.addEventListener("change", () => {
    const files = [...fileInput.files];
    state.pendingFiles.push(...files);
    fileInput.value = "";
    renderAttachPreview();
  });

  msgInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSend();
    }
  });
  msgInput.addEventListener("input", () => {
    msgInput.style.height = "auto";
    msgInput.style.height = Math.min(msgInput.scrollHeight, 140) + "px";
  });

  // Paste images
  msgInput.addEventListener("paste", (e) => {
    const items = [...(e.clipboardData?.items || [])];
    for (const it of items) {
      if (it.type.startsWith("image/")) {
        const f = it.getAsFile();
        if (f) {
          state.pendingFiles.push(f);
          renderAttachPreview();
        }
      }
    }
  });
}

function showWelcome() {
  chatEl.innerHTML = `
    <div class="welcome">
      <h2>Mohan Order Creater</h2>
      <p>PDF, Excel, photo ya text bhejo.<br/>
      Output hamesha: <b>Code | Qty | PO Name</b><br/>
      Cell edit ya chat se change → Confirm pe rule save.</p>
      <p>Master: <b>${state.master.length}</b> products · Rules: <b>${state.rules.length}</b></p>
      ${!state.apiKey ? "<p style='color:#fbbf24'>⚠ Pehle Settings me Gemini API key daalo.</p>" : ""}
    </div>`;
}

function newOrder() {
  // lock previous active tables
  document.querySelectorAll(".table-card.active").forEach((el) => {
    el.classList.remove("active");
    el.classList.add("locked");
    const b = el.querySelector(".badge.on");
    if (b) {
      b.classList.remove("on");
      b.textContent = "previous";
    }
  });
  state.activeOrderId = null;
  state.pendingFiles = [];
  renderAttachPreview();
  chatEl.innerHTML = "";
  addBotText("New order ready. PDF / Excel / image / text bhejo.");
}

// ---------- Settings / storage ----------
function openSettings() {
  document.getElementById("apiKeyInput").value = state.apiKey;
  document.getElementById("modelSelect").value = state.model;
  updateSettingsLabels();
  settingsModal.classList.remove("hidden");
}
function closeSettings() {
  settingsModal.classList.add("hidden");
}
function saveSettings() {
  state.apiKey = document.getElementById("apiKeyInput").value.trim();
  state.model = resolveModel(document.getElementById("modelSelect").value);
  localStorage.setItem(STORAGE.apiKey, state.apiKey);
  localStorage.setItem(STORAGE.model, state.model);
  const sel = document.getElementById("modelSelect");
  if (sel && ![...sel.options].some((o) => o.value === state.model)) {
    const opt = document.createElement("option");
    opt.value = state.model;
    opt.textContent = state.model;
    sel.appendChild(opt);
  }
  if (sel) sel.value = state.model;
  updateSettingsLabels();
  closeSettings();
  addBotText(state.apiKey ? "API key saved on this device only. Model: " + state.model : "API key cleared.");
}
function updateSettingsLabels() {
  const ms = document.getElementById("masterStatus");
  if (ms) ms.textContent = `${state.master.length} products loaded`;
  const rs = document.getElementById("rulesStatus");
  if (rs) rs.textContent = `${state.rules.length} rules saved`;
}

function loadRules() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE.rules) || "[]");
  } catch {
    return [];
  }
}
function saveRules() {
  localStorage.setItem(STORAGE.rules, JSON.stringify(state.rules));
  updateSettingsLabels();
}

function exportRules() {
  const blob = new Blob([JSON.stringify(state.rules, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `mohan-rules-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
}
async function importRules(e) {
  const f = e.target.files?.[0];
  if (!f) return;
  try {
    const text = await f.text();
    const data = JSON.parse(text);
    if (!Array.isArray(data)) throw new Error("Invalid rules file");
    state.rules = data;
    saveRules();
    addBotText(`Imported ${data.length} rules.`);
  } catch (err) {
    alert("Import failed: " + err.message);
  }
  e.target.value = "";
}
function clearRules() {
  if (!confirm("Clear ALL saved rules on this device?")) return;
  state.rules = [];
  saveRules();
}

async function loadMaster() {
  // try localStorage cache first
  try {
    const cached = localStorage.getItem(STORAGE.master);
    if (cached) {
      state.master = JSON.parse(cached);
      if (state.master.length) return;
    }
  } catch (_) {}
  try {
    const res = await fetch("./master.json", { cache: "no-cache" });
    if (res.ok) {
      state.master = await res.json();
      localStorage.setItem(STORAGE.master, JSON.stringify(state.master));
    }
  } catch (_) {}
}

async function onMasterUpload(e) {
  const f = e.target.files?.[0];
  if (!f) return;
  try {
    const products = await parseMasterFile(f);
    if (!products.length) throw new Error("No products found");
    state.master = products;
    localStorage.setItem(STORAGE.master, JSON.stringify(products));
    updateSettingsLabels();
    addBotText(`Master updated: ${products.length} products from ${f.name}`);
  } catch (err) {
    alert("Master upload failed: " + err.message);
  }
  e.target.value = "";
}

async function parseMasterFile(file) {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
  if (!rows.length) return [];
  const header = rows[0].map((h) => String(h).toLowerCase().trim());
  let codeIdx = header.findIndex((h) => /material|code|sku|item\s*code/.test(h));
  let nameIdx = header.findIndex((h) => /description|product|name|item\s*name/.test(h));
  if (codeIdx < 0) codeIdx = 1;
  if (nameIdx < 0) nameIdx = 2;
  const minIdx = header.findIndex((h) => /minimum|min/.test(h));
  const caseIdx = header.findIndex((h) => /case/.test(h));
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const code = String(r[codeIdx] ?? "").trim();
    const name = String(r[nameIdx] ?? "").trim();
    if (!code || !name) continue;
    out.push({
      code,
      name,
      min_qty: minIdx >= 0 ? numOrNull(r[minIdx]) : null,
      case_qty: caseIdx >= 0 ? numOrNull(r[caseIdx]) : null,
    });
  }
  return out;
}

// ---------- Chat UI helpers ----------
function addUserBubble(text, files = []) {
  const wrap = document.createElement("div");
  wrap.className = "msg user";
  const names = files.map((f) => f.name || "file").join(", ");
  wrap.innerHTML = `<div class="meta">You</div><div class="bubble"></div>`;
  const bubble = wrap.querySelector(".bubble");
  let t = text || "";
  if (names) t = (t ? t + "\n" : "") + "📎 " + names;
  bubble.textContent = t || "(attachment)";
  chatEl.appendChild(wrap);
  scrollChat();
}

function addBotText(text) {
  const wrap = document.createElement("div");
  wrap.className = "msg bot";
  wrap.innerHTML = `<div class="meta">Mohan OC</div><div class="bubble"></div>`;
  wrap.querySelector(".bubble").textContent = text;
  chatEl.appendChild(wrap);
  scrollChat();
  return wrap;
}

function addTyping() {
  const wrap = document.createElement("div");
  wrap.className = "msg bot";
  wrap.id = "typingMsg";
  wrap.innerHTML = `<div class="meta">Mohan OC</div><div class="bubble"><span class="typing"><i></i><i></i><i></i></span></div>`;
  chatEl.appendChild(wrap);
  scrollChat();
  return wrap;
}
function removeTyping() {
  document.getElementById("typingMsg")?.remove();
}

function scrollChat() {
  requestAnimationFrame(() => {
    chatEl.scrollTop = chatEl.scrollHeight;
  });
}

function renderAttachPreview() {
  if (!state.pendingFiles.length) {
    attachPreview.classList.add("hidden");
    attachPreview.innerHTML = "";
    return;
  }
  attachPreview.classList.remove("hidden");
  attachPreview.innerHTML = state.pendingFiles
    .map(
      (f, i) =>
        `<span class="chip">${escapeHtml(f.name || "file")} <button type="button" data-i="${i}" aria-label="remove">✕</button></span>`
    )
    .join("");
  attachPreview.querySelectorAll("button").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.pendingFiles.splice(+btn.dataset.i, 1);
      renderAttachPreview();
    });
  });
}

// ---------- Send / process ----------
async function onSend() {
  const text = msgInput.value.trim();
  const files = [...state.pendingFiles];
  if (!text && !files.length) return;

  // welcome clear
  if (chatEl.querySelector(".welcome")) chatEl.innerHTML = "";

  addUserBubble(text, files);
  msgInput.value = "";
  msgInput.style.height = "auto";
  state.pendingFiles = [];
  renderAttachPreview();

  if (!state.apiKey) {
    addBotText("Gemini API key missing. Settings ⚙ me key daalo (aistudio.google.com).");
    openSettings();
    return;
  }

  btnSend.disabled = true;
  const typing = addTyping();

  try {
    const hasOrderMaterial =
      files.length > 0 || looksLikeOrderText(text) || !state.activeOrderId;

    if (files.length || looksLikeOrderText(text)) {
      await processOrder({ text, files });
    } else if (state.activeOrderId && text) {
      await processChatEdit(text);
    } else if (text) {
      // general / first message without clear order — still try parse
      await processOrder({ text, files: [] });
    } else {
      addBotText("Kuch text ya file bhejo.");
    }
  } catch (err) {
    console.error(err);
    removeTyping();
    addBotText("Error: " + (err.message || String(err)));
  } finally {
    removeTyping();
    btnSend.disabled = false;
  }
}

function looksLikeOrderText(t) {
  if (!t || t.length < 8) return false;
  // short instruction-like messages
  if (t.length < 80 && /^(change|update|set|rule|yaad|save|code|qty|quantity|party|fix|mat|do|please)/i.test(t)) {
    return false;
  }
  if (/\b(qty|quantity|tabs?|cream|syrup|lotion|soap|ml|gm|mg|strip|bottle|order|po\b)/i.test(t)) return true;
  if (t.split("\n").length >= 3) return true;
  return t.length > 120;
}

async function processOrder({ text, files }) {
  const extractedParts = [];
  for (const f of files) {
    const part = await fileToModelPart(f);
    if (part) extractedParts.push(part);
  }

  // Also extract plain text from excel/pdf locally as backup context
  let localText = text || "";
  for (const f of files) {
    try {
      const t = await extractLocalText(f);
      if (t) localText += "\n\n--- " + f.name + " ---\n" + t;
    } catch (_) {}
  }

  const parsed = await geminiParseOrder({
    userText: text,
    localText,
    parts: extractedParts,
  });

  const rows = (parsed.items || []).map((it) => {
    const poName = String(it.po_name || it.name || "").trim();
    const pack = String(it.pack || "").trim();
    const qty = normalizeQty(it.qty);
    const party = String(it.party || parsed.party || "").trim();
    const match = matchProduct({ poName, pack, party });
    return {
      code: match.code || "",
      qty,
      po_name: poName,
      pack,
      party,
      status: match.status, // green | yellow | red
      master_name: match.master_name || "",
      confidence: match.confidence || 0,
      note: match.note || "",
    };
  });

  // apply qty rules
  for (const r of rows) applyQtyRules(r);

  const orderId = "ord_" + Date.now();
  state.activeOrderId = orderId;
  state.orders.set(orderId, {
    rows,
    meta: {
      party: parsed.party || "",
      order_no: parsed.order_no || "",
      order_date: parsed.order_date || "",
      source: files.map((f) => f.name).join(", ") || "text",
    },
  });

  removeTyping();
  renderOrderTable(orderId);

  const g = rows.filter((r) => r.status === "green").length;
  const y = rows.filter((r) => r.status === "yellow").length;
  const r = rows.filter((r) => r.status === "red").length;
  addBotText(
    `Parsed ${rows.length} lines. 🟢 ${g} sure · 🟡 ${y} check · 🔴 ${r} no code.\n` +
      (parsed.party ? `Party: ${parsed.party}\n` : "") +
      `Output order: Code → Qty → PO Name. Cell edit or type a change.`
  );
}

async function processChatEdit(text) {
  const order = state.orders.get(state.activeOrderId);
  if (!order) {
    addBotText("Koi active order nahi. Pehle PO bhejo.");
    return;
  }

  const draft = await geminiInterpretEdit({
    message: text,
    rows: order.rows,
    meta: order.meta,
  });

  removeTyping();

  if (draft.type === "chat" || draft.type === "info") {
    addBotText(draft.message || "OK");
    return;
  }

  // Propose rule + row updates
  const summary = formatDraftSummary(draft);
  addBotText("Samajh gaya:\n" + summary);

  const ok = await askConfirm(summary + "\n\nSave rule / apply changes?");
  if (!ok) {
    addBotText("Cancel — kuch save nahi hua.");
    return;
  }

  // Apply row patches
  if (Array.isArray(draft.row_updates)) {
    for (const u of draft.row_updates) {
      const idx = findRowIndex(order.rows, u);
      if (idx < 0) continue;
      const row = order.rows[idx];
      if (u.code != null && String(u.code).trim() !== "") {
        row.code = String(u.code).trim();
        row.status = "green";
        row.note = "updated by chat";
      }
      if (u.qty != null && u.qty !== "") row.qty = normalizeQty(u.qty);
      if (u.po_name) row.po_name = String(u.po_name);
      if (u.pack) row.pack = String(u.pack);
    }
  }

  // Upsert rules
  if (Array.isArray(draft.rules)) {
    for (const rule of draft.rules) upsertRule(rule);
  } else if (draft.rule) {
    upsertRule(draft.rule);
  }

  // Re-render
  document.querySelector(`.table-card[data-oid="${state.activeOrderId}"]`)?.remove();
  renderOrderTable(state.activeOrderId);
  addBotText("Applied. Rules: " + state.rules.length);
}

function findRowIndex(rows, u) {
  if (typeof u.row === "number" && u.row >= 0 && u.row < rows.length) return u.row;
  if (u.po_name) {
    const n = norm(u.po_name);
    const i = rows.findIndex((r) => norm(r.po_name).includes(n) || n.includes(norm(r.po_name)));
    if (i >= 0) return i;
  }
  if (u.code) {
    const i = rows.findIndex((r) => String(r.code) === String(u.code));
    if (i >= 0) return i;
  }
  return -1;
}

function formatDraftSummary(draft) {
  const lines = [];
  if (draft.message) lines.push(draft.message);
  if (draft.row_updates?.length) {
    lines.push("Row changes:");
    for (const u of draft.row_updates) {
      lines.push(
        `  • row ${u.row ?? "?"} ${u.po_name || ""} → code=${u.code ?? "—"} qty=${u.qty ?? "—"}`
      );
    }
  }
  const rules = draft.rules || (draft.rule ? [draft.rule] : []);
  if (rules.length) {
    lines.push("Rules to save:");
    for (const r of rules) {
      lines.push(
        `  • [${r.party || "*"}] ${r.pattern || r.po_name || ""} ${r.pack || ""} → ${r.code || ""} ${
          r.qty_multiple ? "×" + r.qty_multiple : ""
        }`
      );
    }
  }
  return lines.join("\n") || JSON.stringify(draft, null, 2);
}

function upsertRule(rule) {
  if (!rule) return;
  const pattern = String(rule.pattern || rule.po_name || "").trim();
  if (!pattern && !rule.code) return;
  const party = String(rule.party || "").trim();
  const pack = String(rule.pack || "").trim();
  const keyMatch = (r) =>
    norm(r.pattern) === norm(pattern) &&
    norm(r.party || "") === norm(party) &&
    norm(r.pack || "") === norm(pack);

  const idx = state.rules.findIndex(keyMatch);
  const row = {
    id: idx >= 0 ? state.rules[idx].id : "r_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7),
    pattern,
    party,
    pack,
    pack_exclude: String(rule.pack_exclude || "").trim(),
    code: rule.code != null ? String(rule.code).trim() : idx >= 0 ? state.rules[idx].code : "",
    qty_multiple: rule.qty_multiple != null ? Number(rule.qty_multiple) || null : idx >= 0 ? state.rules[idx].qty_multiple : null,
    note: rule.note || "",
    updated_at: new Date().toISOString(),
  };
  if (idx >= 0) state.rules[idx] = { ...state.rules[idx], ...row };
  else state.rules.push(row);
  saveRules();
}

function askConfirm(text) {
  confirmBody.textContent = text;
  confirmModal.classList.remove("hidden");
  return new Promise((resolve) => {
    state.confirmResolver = resolve;
  });
}
function finishConfirm(yes) {
  confirmModal.classList.add("hidden");
  const r = state.confirmResolver;
  state.confirmResolver = null;
  if (r) r(yes);
}

// ---------- Table render / edit / copy ----------
function renderOrderTable(orderId) {
  const order = state.orders.get(orderId);
  if (!order) return;

  // demote other actives
  document.querySelectorAll(".table-card.active").forEach((el) => {
    if (el.dataset.oid !== orderId) {
      el.classList.remove("active");
      el.classList.add("locked");
      const b = el.querySelector(".badge.on");
      if (b) {
        b.classList.remove("on");
        b.textContent = "previous";
      }
    }
  });

  const card = document.createElement("div");
  card.className = "table-card active msg bot";
  card.dataset.oid = orderId;
  card.style.maxWidth = "min(100%, 760px)";

  const meta = order.meta || {};
  card.innerHTML = `
    <div class="table-toolbar">
      <span class="title">${escapeHtml(meta.party || "Order")}${
    meta.order_no ? " · #" + escapeHtml(meta.order_no) : ""
  }</span>
      <span class="badge on">ACTIVE</span>
      <button type="button" class="btn ghost btn-copy-codes" title="Copy codes column">Copy Codes</button>
      <button type="button" class="btn ghost btn-copy-qty" title="Copy qty column">Copy Qty</button>
      <button type="button" class="btn ghost btn-copy-names" title="Copy names">Copy Names</button>
      <button type="button" class="btn primary btn-copy-tsv" title="Copy full table for Excel">Copy Excel</button>
    </div>
    <div class="table-scroll">
      <table class="order-table">
        <thead>
          <tr>
            <th class="row-status"></th>
            <th>Code</th>
            <th>Qty</th>
            <th>PO Name</th>
          </tr>
        </thead>
        <tbody></tbody>
      </table>
    </div>
  `;

  const tbody = card.querySelector("tbody");
  order.rows.forEach((row, idx) => {
    const tr = document.createElement("tr");
    tr.dataset.idx = idx;
    tr.innerHTML = `
      <td class="row-status"><span class="st-${row.status || "red"}"></span></td>
      <td class="cell code" contenteditable="true" spellcheck="false"></td>
      <td class="cell qty" contenteditable="true" spellcheck="false"></td>
      <td class="cell po-name" contenteditable="true" spellcheck="false"></td>
    `;
    tr.querySelector(".code").textContent = row.code || "";
    tr.querySelector(".qty").textContent = row.qty ?? "";
    const nameCell = tr.querySelector(".po-name");
    nameCell.textContent = row.po_name || "";
    if (row.master_name || row.pack || row.note) {
      const hint = document.createElement("span");
      hint.className = "match-hint";
      hint.textContent = [row.pack && `Pack: ${row.pack}`, row.master_name && `→ ${row.master_name}`, row.note]
        .filter(Boolean)
        .join(" · ");
      nameCell.appendChild(document.createElement("br"));
      nameCell.appendChild(hint);
    }

    // edit handlers
    tr.querySelectorAll(".cell").forEach((cell) => {
      cell.addEventListener("focus", () => {
        // strip hint from name when editing
        if (cell.classList.contains("po-name")) {
          cell.dataset.full = row.po_name;
          cell.textContent = row.po_name || "";
        }
      });
      cell.addEventListener("blur", async () => {
        await onCellEdit(orderId, idx, cell);
      });
      cell.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          cell.blur();
        }
      });
    });

    tbody.appendChild(tr);
  });

  card.querySelector(".btn-copy-codes").onclick = () =>
    copyText(order.rows.map((r) => r.code || "").join("\n"), "Codes copied");
  card.querySelector(".btn-copy-qty").onclick = () =>
    copyText(order.rows.map((r) => r.qty ?? "").join("\n"), "Qty copied");
  card.querySelector(".btn-copy-names").onclick = () =>
    copyText(order.rows.map((r) => r.po_name || "").join("\n"), "Names copied");
  card.querySelector(".btn-copy-tsv").onclick = () => {
    const header = "Code\tQty\tPO Name";
    const body = order.rows.map((r) => `${r.code || ""}\t${r.qty ?? ""}\t${r.po_name || ""}`).join("\n");
    copyText(header + "\n" + body, "Table copied — Excel me Ctrl+V");
  };

  chatEl.appendChild(card);
  scrollChat();
}

async function onCellEdit(orderId, idx, cell) {
  const order = state.orders.get(orderId);
  if (!order) return;
  const row = order.rows[idx];
  if (!row) return;

  let raw = cell.innerText.replace(/\u00a0/g, " ").trim();
  // if name cell had hint lines, take first line only
  if (cell.classList.contains("po-name")) {
    raw = raw.split("\n")[0].trim();
  }

  let changed = false;
  let ruleDraft = null;

  if (cell.classList.contains("code")) {
    const v = raw;
    if (v !== String(row.code || "")) {
      const old = row.code;
      row.code = v;
      row.status = v ? "green" : "red";
      row.note = "manual edit";
      changed = true;
      if (v) {
        ruleDraft = {
          pattern: row.po_name,
          pack: row.pack,
          party: row.party || order.meta?.party || "",
          code: v,
          note: `from cell edit (was ${old || "empty"})`,
        };
      }
    }
  } else if (cell.classList.contains("qty")) {
    const v = normalizeQty(raw);
    if (v !== row.qty) {
      row.qty = v;
      changed = true;
    }
  } else if (cell.classList.contains("po-name")) {
    if (raw !== row.po_name) {
      row.po_name = raw;
      changed = true;
    }
  }

  // re-render row hints
  refreshRowDom(orderId, idx);

  if (ruleDraft) {
    const ok = await askConfirm(
      `Save rule?\n\n"${ruleDraft.pattern}" ${ruleDraft.pack || ""}\n→ Code ${ruleDraft.code}\nParty: ${
        ruleDraft.party || "*"
      }`
    );
    if (ok) {
      upsertRule(ruleDraft);
      addBotText(`Rule saved: ${ruleDraft.pattern} → ${ruleDraft.code}`);
    }
  } else if (changed) {
    // silent qty/name change only
  }
}

function refreshRowDom(orderId, idx) {
  const order = state.orders.get(orderId);
  const card = document.querySelector(`.table-card[data-oid="${orderId}"]`);
  if (!order || !card) return;
  const row = order.rows[idx];
  const tr = card.querySelector(`tr[data-idx="${idx}"]`);
  if (!tr || !row) return;
  tr.querySelector(".row-status span").className = `st-${row.status || "red"}`;
  tr.querySelector(".code").textContent = row.code || "";
  tr.querySelector(".qty").textContent = row.qty ?? "";
  const nameCell = tr.querySelector(".po-name");
  nameCell.textContent = row.po_name || "";
  if (row.master_name || row.pack || row.note) {
    const hint = document.createElement("span");
    hint.className = "match-hint";
    hint.textContent = [row.pack && `Pack: ${row.pack}`, row.master_name && `→ ${row.master_name}`, row.note]
      .filter(Boolean)
      .join(" · ");
    nameCell.appendChild(document.createElement("br"));
    nameCell.appendChild(hint);
  }
}

async function copyText(text, okMsg) {
  try {
    await navigator.clipboard.writeText(text);
    toast(okMsg || "Copied");
  } catch {
    // fallback
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
    toast(okMsg || "Copied");
  }
}

function toast(msg) {
  addBotText(msg);
}

// ---------- Matching engine ----------
function matchProduct({ poName, pack, party }) {
  const nPo = norm(poName);
  const nPack = norm(pack);
  const nParty = norm(party);

  if (!nPo) return { status: "red", code: "", note: "empty name" };

  // 1) Rules exact-ish
  let bestRule = null;
  let bestRuleScore = 0;
  for (const r of state.rules) {
    const rp = norm(r.pattern);
    if (!rp) continue;
    if (r.party && nParty && norm(r.party) !== nParty && !nParty.includes(norm(r.party))) {
      // party-specific rule, skip if party mismatch when both present
      if (norm(r.party).length > 2) continue;
    }
    let score = 0;
    if (nPo === rp) score = 100;
    else if (nPo.includes(rp) || rp.includes(nPo)) score = 80;
    else {
      // token overlap
      score = tokenScore(nPo, rp) * 70;
    }
    if (r.pack) {
      const rpk = norm(r.pack);
      if (nPack && (nPack.includes(rpk) || rpk.includes(nPack) || packLooseEqual(nPack, rpk))) score += 15;
      else if (nPack) score -= 25;
    }
    if (r.pack_exclude && nPack && norm(r.pack_exclude).split(/[,\s]+/).some((x) => x && nPack.includes(x))) {
      score -= 50;
    }
    if (score > bestRuleScore) {
      bestRuleScore = score;
      bestRule = r;
    }
  }
  if (bestRule && bestRuleScore >= 75 && bestRule.code) {
    return {
      status: "green",
      code: bestRule.code,
      master_name: bestRule.note || "rule",
      confidence: bestRuleScore,
      note: "rule match",
    };
  }

  // 2) Master list
  if (!state.master.length) {
    return { status: "red", code: "", note: "no master loaded" };
  }

  const candidates = [];
  for (const p of state.master) {
    const mn = norm(p.name);
    let score = tokenScore(nPo, mn);
    // boost brand first token
    const poToks = tokens(nPo);
    const mToks = tokens(mn);
    if (poToks[0] && mToks[0] && poToks[0] === mToks[0]) score += 0.15;
    // pack signals from master name
    if (nPack) {
      if (mn.includes(nPack.replace(/\s/g, "")) || packInText(nPack, mn)) score += 0.2;
      // penalize form mismatch
      if (isTab(nPo, nPack) && isSyrupName(mn)) score -= 0.5;
      if (isSyrup(nPo, nPack) && isTabName(mn)) score -= 0.5;
    } else {
      if (isTab(nPo, "") && isSyrupName(mn)) score -= 0.35;
      if (isSyrup(nPo, "") && isTabName(mn)) score -= 0.35;
    }
    // size numbers
    const sizes = extractSizes(nPo + " " + nPack);
    if (sizes.length) {
      const masterSizes = extractSizes(mn);
      if (masterSizes.some((s) => sizes.includes(s))) score += 0.15;
    }
    if (score >= 0.35) candidates.push({ p, score });
  }
  candidates.sort((a, b) => b.score - a.score);

  if (!candidates.length) {
    if (bestRule && bestRule.code && bestRuleScore >= 55) {
      return {
        status: "yellow",
        code: bestRule.code,
        master_name: "weak rule",
        confidence: bestRuleScore,
        note: "weak rule — check",
      };
    }
    return { status: "red", code: "", note: "no match", confidence: 0 };
  }

  const top = candidates[0];
  const second = candidates[1];
  const ambiguous = second && top.score - second.score < 0.08 && second.score > 0.45;

  if (top.score >= 0.62 && !ambiguous) {
    return {
      status: "green",
      code: top.p.code,
      master_name: top.p.name,
      confidence: top.score,
      note: "",
    };
  }
  if (top.score >= 0.45) {
    return {
      status: "yellow",
      code: top.p.code,
      master_name: top.p.name + (second ? ` | alt: ${second.p.name}` : ""),
      confidence: top.score,
      note: ambiguous ? "ambiguous — verify" : "low confidence",
    };
  }
  return {
    status: "red",
    code: "",
    master_name: top.p.name,
    confidence: top.score,
    note: "low score — fill code",
  };
}

function applyQtyRules(row) {
  const nPo = norm(row.po_name);
  const nParty = norm(row.party);
  for (const r of state.rules) {
    if (!r.qty_multiple) continue;
    const rp = norm(r.pattern);
    if (!rp) continue;
    if (!(nPo.includes(rp) || rp.includes(nPo) || tokenScore(nPo, rp) > 0.7)) continue;
    if (r.party && nParty && norm(r.party) !== nParty && !nParty.includes(norm(r.party))) continue;
    const m = Number(r.qty_multiple);
    if (m > 1 && row.qty != null) {
      // do not auto-change qty silently; only flag in note if not multiple
      if (Number(row.qty) % m !== 0) {
        row.note = (row.note ? row.note + " · " : "") + `qty should be ×${m}`;
        if (row.status === "green") row.status = "yellow";
      }
    }
  }
}

// ---------- Gemini ----------
async function geminiParseOrder({ userText, localText, parts }) {
  const masterHint = state.master
    .slice(0, 80)
    .map((p) => `${p.code}|${p.name}`)
    .join("\n");

  const sys = `You extract purchase order line items from messy distributor POs (PDF text, Excel, photos, plain text).
Return ONLY valid JSON (no markdown) with shape:
{
  "party": "buyer or seller party name if visible",
  "order_no": "",
  "order_date": "",
  "items": [
    { "po_name": "exact product name as written in PO", "pack": "pack/size as written", "qty": number, "party": "" }
  ]
}
Rules:
- po_name = exactly how it appears on the PO (keep distributor wording).
- qty = ordered quantity (numeric). Ignore free schemes unless clearly the main qty.
- Do NOT invent material codes.
- Skip headers, totals, addresses.
- One row per product line.
- If image/PDF, read all product lines carefully.`;

  const contents = [];
  const userParts = [];

  userParts.push({
    text:
      sys +
      "\n\nUser message:\n" +
      (userText || "(see attachments)") +
      "\n\nLocal extracted text (may be incomplete):\n" +
      truncate(localText || "", 120000) +
      "\n\nSample master products (for context only, do not output codes):\n" +
      masterHint,
  });

  for (const p of parts) userParts.push(p);

  contents.push({ role: "user", parts: userParts });

  const data = await geminiRequest({
    contents,
    generationConfig: {
      temperature: 0.1,
      responseMimeType: "application/json",
    },
  });

  const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "";
  const json = safeJson(text);
  if (!json || !Array.isArray(json.items)) {
    throw new Error("Could not parse order JSON from model. Try clearer photo/PDF or paste text.");
  }
  return json;
}

async function geminiInterpretEdit({ message, rows, meta }) {
  const snapshot = rows.map((r, i) => ({
    row: i,
    code: r.code,
    qty: r.qty,
    po_name: r.po_name,
    pack: r.pack,
    party: r.party,
    status: r.status,
  }));

  const prompt = `You are helping edit a PO matching table and save durable rules.
Current order meta: ${JSON.stringify(meta)}
Current rows JSON:
${JSON.stringify(snapshot)}

User said: ${JSON.stringify(message)}

Return ONLY JSON:
{
  "type": "edit" | "chat" | "info",
  "message": "short human summary",
  "row_updates": [ { "row": 0, "code": "", "qty": 0, "po_name": "", "pack": "" } ],
  "rules": [
     { "pattern": "ALASPAN TAB", "pack": "10TAB", "party": "", "code": "401353005", "qty_multiple": null, "note": "" }
  ]
}
Rules for you:
- pattern = distributor PO name text to match later.
- UPSERT style: one rule per pattern+pack+party (we replace old).
- If user changes a code, emit both row_updates and rules.
- If user only asks a question, type=chat and empty arrays.
- Do not invent codes unless user stated the code OR it is already in the row.
- qty_multiple only if user asked multiples/min case packs.`;

  const data = await geminiRequest({
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.1, responseMimeType: "application/json" },
  });
  const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "";
  const json = safeJson(text);
  if (!json) return { type: "chat", message: text || "Could not interpret." };
  return json;
}

async function geminiRequest({ contents, generationConfig }) {
  let model = resolveModel(state.model || "gemini-3.6-flash");
  state.model = model;

  const urlFor = (m) =>
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      m
    )}:generateContent?key=${encodeURIComponent(state.apiKey)}`;

  let res = await fetch(urlFor(model), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contents, generationConfig }),
  });
  let body = await res.json().catch(() => ({}));

  // Auto-fallback if model retired / not found
  const errMsg = body?.error?.message || "";
  if (
    !res.ok &&
    (/no longer available|not found|is not found|not supported/i.test(errMsg) ||
      res.status === 404)
  ) {
    const fallbacks = ["gemini-3.6-flash", "gemini-2.5-flash", "gemini-2.0-flash-lite"].filter(
      (m) => m !== model
    );
    for (const fb of fallbacks) {
      res = await fetch(urlFor(fb), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents, generationConfig }),
      });
      body = await res.json().catch(() => ({}));
      if (res.ok) {
        state.model = fb;
        try {
          localStorage.setItem(STORAGE.model, fb);
        } catch (_) {}
        break;
      }
    }
  }

  if (!res.ok) {
    const msg = body?.error?.message || res.statusText;
    if (res.status === 429) throw new Error("API limit hit (429). Thoda wait karke dubara try karo.");
    if (res.status === 400 && /API key/i.test(msg)) throw new Error("Invalid API key. Settings me check karo.");
    throw new Error(msg || "Gemini request failed");
  }
  return body;
}

// ---------- File helpers ----------
async function fileToModelPart(file) {
  const mime = file.type || guessMime(file.name);
  if (mime.startsWith("image/")) {
    const b64 = await fileToBase64(file);
    return { inlineData: { mimeType: mime, data: b64 } };
  }
  if (mime === "application/pdf") {
    // send as inline pdf if small enough; also text extracted separately
    if (file.size < 15 * 1024 * 1024) {
      const b64 = await fileToBase64(file);
      return { inlineData: { mimeType: "application/pdf", data: b64 } };
    }
  }
  // excel/csv/txt: text only via local extract
  return null;
}

async function extractLocalText(file) {
  const name = (file.name || "").toLowerCase();
  const mime = file.type || guessMime(file.name);
  if (mime.startsWith("text/") || name.endsWith(".txt") || name.endsWith(".csv")) {
    return await file.text();
  }
  if (name.endsWith(".xlsx") || name.endsWith(".xls") || mime.includes("sheet")) {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array" });
    let out = "";
    for (const sn of wb.SheetNames) {
      out += `\n[Sheet ${sn}]\n`;
      out += XLSX.utils.sheet_to_csv(wb.Sheets[sn]);
    }
    return out;
  }
  if (mime === "application/pdf" || name.endsWith(".pdf")) {
    return await pdfToText(file);
  }
  if (mime.startsWith("image/")) {
    return ""; // model reads image
  }
  // try text
  try {
    return await file.text();
  } catch {
    return "";
  }
}

async function pdfToText(file) {
  if (!window.pdfjsLib) return "";
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  let text = "";
  const max = Math.min(pdf.numPages, 20);
  for (let i = 1; i <= max; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    text += content.items.map((it) => it.str).join(" ") + "\n";
  }
  return text;
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const s = String(r.result || "");
      const i = s.indexOf(",");
      resolve(i >= 0 ? s.slice(i + 1) : s);
    };
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

function guessMime(name = "") {
  const n = name.toLowerCase();
  if (n.endsWith(".pdf")) return "application/pdf";
  if (n.endsWith(".png")) return "image/png";
  if (n.endsWith(".jpg") || n.endsWith(".jpeg")) return "image/jpeg";
  if (n.endsWith(".webp")) return "image/webp";
  if (n.endsWith(".xlsx")) return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (n.endsWith(".xls")) return "application/vnd.ms-excel";
  if (n.endsWith(".csv")) return "text/csv";
  if (n.endsWith(".txt")) return "text/plain";
  return "application/octet-stream";
}

// ---------- utils ----------
function norm(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9%]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
function tokens(s) {
  return norm(s)
    .split(" ")
    .filter((t) => t && t.length > 1 && !["the", "and", "for", "of", "with"].includes(t));
}
function tokenScore(a, b) {
  const ta = new Set(tokens(a));
  const tb = new Set(tokens(b));
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  const union = new Set([...ta, ...tb]).size;
  // bias toward coverage of PO tokens
  const cover = inter / ta.size;
  const jacc = inter / union;
  return cover * 0.65 + jacc * 0.35;
}
function packLooseEqual(a, b) {
  const x = a.replace(/\s/g, "");
  const y = b.replace(/\s/g, "");
  return x === y || x.includes(y) || y.includes(x);
}
function packInText(pack, text) {
  const p = pack.replace(/\s/g, "");
  const t = text.replace(/\s/g, "");
  return t.includes(p);
}
function extractSizes(s) {
  const out = [];
  const re = /(\d+(?:\.\d+)?)\s*(ml|mg|gm|g|kg|tab|tabs|s|mm)?/gi;
  let m;
  while ((m = re.exec(String(s)))) {
    out.push(norm(m[1] + (m[2] || "")));
  }
  return out;
}
function isTab(name, pack) {
  return /\b(tab|tabs|tablet|tablets|strip)\b/.test(norm(name + " " + pack));
}
function isSyrup(name, pack) {
  return /\b(syrup|syp|suspension|bottle)\b/.test(norm(name + " " + pack)) || /\bml\b/.test(norm(pack));
}
function isTabName(n) {
  return /\b(tab|tablet|strip)\b/.test(n);
}
function isSyrupName(n) {
  return /\b(syrup|syp|lotion|ml)\b/.test(n) && !/\btablet\b/.test(n);
}
function normalizeQty(q) {
  if (q == null || q === "") return "";
  if (typeof q === "number" && !Number.isNaN(q)) return q;
  const s = String(q).replace(/,/g, "").trim();
  const m = s.match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : s;
}
function numOrNull(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function truncate(s, n) {
  return s.length > n ? s.slice(0, n) + "\n…[truncated]" : s;
}
function safeJson(text) {
  if (!text) return null;
  let t = text.trim();
  if (t.startsWith("```")) {
    t = t.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  }
  try {
    return JSON.parse(t);
  } catch {
    const a = t.indexOf("{");
    const b = t.lastIndexOf("}");
    if (a >= 0 && b > a) {
      try {
        return JSON.parse(t.slice(a, b + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
