/**
 * Mohan Order Creater — strong AI + local master tools + learning
 * Parse PO via Gemini → match master/rules → Code | Qty | PO Name
 * Chat can search master, fix rows, save rules. API key local only.
 */

const STORAGE = {
  apiKey: "moc_api_key",
  model: "moc_model",
  rules: "moc_rules_v1",
  master: "moc_master_v1",
  stats: "moc_stats_v1",
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

function loadJSON(key, fallback) {
  try {
    const v = JSON.parse(localStorage.getItem(key) || "null");
    return v == null ? fallback : v;
  } catch {
    return fallback;
  }
}

function loadRules() {
  return loadJSON(STORAGE.rules, []);
}

function loadStats() {
  return loadJSON(STORAGE.stats, {
    orders_processed: 0,
    rules_learned: 0,
    cells_fixed: 0,
    master_lookups: 0,
    last_order_green: 0,
    last_order_total: 0,
  });
}

const state = {
  apiKey: localStorage.getItem(STORAGE.apiKey) || "",
  model: resolveModel(localStorage.getItem(STORAGE.model)),
  master: [],
  rules: loadRules(),
  stats: loadStats(),
  pendingFiles: [],
  activeOrderId: null,
  orders: new Map(),
  confirmResolver: null,
  brandIndex: new Map(),
};

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

init();

async function init() {
  setupPdfJs();
  bindUi();
  setupMobileViewport();
  await loadMaster();
  rebuildBrandIndex();
  updateSettingsLabels();
  updateLearningBar();
  showWelcome();
  if (!state.apiKey) setTimeout(() => openSettings(), 400);
  if ("serviceWorker" in navigator) {
    try {
      await navigator.serviceWorker.register("./sw.js");
    } catch (_) {}
  }
}

function setupMobileViewport() {
  const app = document.getElementById("app");
  if (!app) return;
  const apply = () => {
    try {
      if (window.visualViewport) {
        const vv = window.visualViewport;
        app.style.height = Math.round(vv.height) + "px";
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
    state.pendingFiles.push(...fileInput.files);
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
    msgInput.style.height = Math.min(msgInput.scrollHeight, 120) + "px";
  });
  msgInput.addEventListener("paste", (e) => {
    for (const it of e.clipboardData?.items || []) {
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

// ---------- Learning progress ----------
function saveStats() {
  try {
    localStorage.setItem(STORAGE.stats, JSON.stringify(state.stats));
  } catch (_) {}
  updateLearningBar();
  updateSettingsLabels();
}

function bumpStat(key, n = 1) {
  state.stats[key] = (state.stats[key] || 0) + n;
  saveStats();
}

function learningPercent() {
  // Rough progress: rules learned toward "strong" (cap 200 for 100%)
  const rules = state.rules.length;
  const orders = state.stats.orders_processed || 0;
  const score = Math.min(100, Math.round(rules * 0.45 + Math.min(orders, 80) * 0.4 + Math.min(state.stats.cells_fixed || 0, 40) * 0.2));
  return Math.max(score, rules > 0 || orders > 0 ? 3 : 0);
}

function updateLearningBar() {
  let bar = document.getElementById("learningBar");
  if (!bar) {
    bar = document.createElement("div");
    bar.id = "learningBar";
    bar.className = "learning-bar";
    const top = document.querySelector(".topbar");
    if (top && top.parentNode) top.insertAdjacentElement("afterend", bar);
  }
  const pct = learningPercent();
  const g = state.stats.last_order_green || 0;
  const t = state.stats.last_order_total || 0;
  const last = t ? Math.round((g / t) * 100) : 0;
  bar.innerHTML = `
    <div class="learning-meta">
      <span>🧠 Learning <b>${pct}%</b></span>
      <span>Rules <b>${state.rules.length}</b></span>
      <span>Orders <b>${state.stats.orders_processed || 0}</b></span>
      ${t ? `<span>Last match <b>${last}%</b></span>` : ""}
    </div>
    <div class="learning-track"><i style="width:${pct}%"></i></div>`;
}

// ---------- Welcome / new order ----------
function showWelcome() {
  chatEl.innerHTML = `
    <div class="welcome">
      <h2>Mohan Order Creater</h2>
      <p>PDF / Excel / photo / text bhejo.<br/>
      Output: <b>Code | Qty | PO Name</b></p>
      <p>Master <b>${state.master.length}</b> · Rules <b>${state.rules.length}</b> · Learning <b>${learningPercent()}%</b></p>
      <p class="tips">Bol sakte ho: <i>“Benadon master me check kar”</i>, <i>“sirf ek hi hai”</i>, <i>“code 400016004”</i></p>
      ${!state.apiKey ? "<p style='color:#fbbf24'>⚠ Settings me Gemini API key daalo.</p>" : ""}
    </div>`;
}

function newOrder() {
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
  addBotText("New order ready. PO bhejo — main master + rules se code bharunga.");
}

// ---------- Settings ----------
function openSettings() {
  document.getElementById("apiKeyInput").value = state.apiKey;
  const sel = document.getElementById("modelSelect");
  if (sel && ![...sel.options].some((o) => o.value === state.model)) {
    const opt = document.createElement("option");
    opt.value = state.model;
    opt.textContent = state.model;
    sel.appendChild(opt);
  }
  if (sel) sel.value = state.model;
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
  updateSettingsLabels();
  closeSettings();
  addBotText(state.apiKey ? "Saved. Model: " + state.model : "API key cleared.");
}
function updateSettingsLabels() {
  const ms = document.getElementById("masterStatus");
  if (ms) ms.textContent = `${state.master.length} products loaded`;
  const rs = document.getElementById("rulesStatus");
  if (rs) rs.textContent = `${state.rules.length} rules · learning ${learningPercent()}%`;
}
function saveRules() {
  localStorage.setItem(STORAGE.rules, JSON.stringify(state.rules));
  updateSettingsLabels();
  updateLearningBar();
}
function exportRules() {
  const blob = new Blob(
    [JSON.stringify({ rules: state.rules, stats: state.stats }, null, 2)],
    { type: "application/json" }
  );
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `mohan-rules-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
}
async function importRules(e) {
  const f = e.target.files?.[0];
  if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    const rules = Array.isArray(data) ? data : data.rules;
    if (!Array.isArray(rules)) throw new Error("Invalid file");
    state.rules = rules;
    if (data.stats) state.stats = { ...state.stats, ...data.stats };
    saveRules();
    saveStats();
    addBotText(`Imported ${rules.length} rules.`);
  } catch (err) {
    alert("Import failed: " + err.message);
  }
  e.target.value = "";
}
function clearRules() {
  if (!confirm("Clear ALL rules?")) return;
  state.rules = [];
  saveRules();
}

async function loadMaster() {
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

function rebuildBrandIndex() {
  state.brandIndex = new Map();
  for (const p of state.master) {
    const b = brandToken(p.name);
    if (!b) continue;
    if (!state.brandIndex.has(b)) state.brandIndex.set(b, []);
    state.brandIndex.get(b).push(p);
  }
}

async function onMasterUpload(e) {
  const f = e.target.files?.[0];
  if (!f) return;
  try {
    const products = await parseMasterFile(f);
    if (!products.length) throw new Error("No products found");
    state.master = products;
    localStorage.setItem(STORAGE.master, JSON.stringify(products));
    rebuildBrandIndex();
    updateSettingsLabels();
    addBotText(`Master updated: ${products.length} products.`);
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

// ---------- Chat UI ----------
function addUserBubble(text, files = []) {
  const wrap = document.createElement("div");
  wrap.className = "msg user";
  wrap.innerHTML = `<div class="meta">You</div><div class="bubble"></div>`;
  const names = files.map((f) => f.name || "file").join(", ");
  let t = text || "";
  if (names) t = (t ? t + "\n" : "") + "📎 " + names;
  wrap.querySelector(".bubble").textContent = t || "(attachment)";
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
  wrap.innerHTML = `<div class="meta">Mohan OC</div><div class="bubble"><span class="typing"><i></i><i></i><i></i></span> soch raha hoon…</div>`;
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
        `<span class="chip">${escapeHtml(f.name || "file")} <button type="button" data-i="${i}">✕</button></span>`
    )
    .join("");
  attachPreview.querySelectorAll("button").forEach((btn) => {
    btn.onclick = () => {
      state.pendingFiles.splice(+btn.dataset.i, 1);
      renderAttachPreview();
    };
  });
}

// ---------- Send ----------
async function onSend() {
  const text = msgInput.value.trim();
  const files = [...state.pendingFiles];
  if (!text && !files.length) return;
  if (chatEl.querySelector(".welcome")) chatEl.innerHTML = "";

  addUserBubble(text, files);
  msgInput.value = "";
  msgInput.style.height = "auto";
  state.pendingFiles = [];
  renderAttachPreview();

  if (!state.apiKey) {
    addBotText("Gemini API key missing. ⚙ Settings me daalo.");
    openSettings();
    return;
  }

  btnSend.disabled = true;
  addTyping();
  try {
    if (files.length || looksLikeOrderText(text)) {
      await processOrder({ text, files });
    } else if (state.activeOrderId && text) {
      await processChatEdit(text);
    } else if (text) {
      // no active order — still try master Q&A
      await processChatEdit(text);
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
  if (
    t.length < 100 &&
    /^(change|update|set|rule|yaad|save|code|qty|quantity|party|fix|check|master|file|benadon|alaspan|sirf|ek hi|only one|map|correct|sahi|galat|mat|do|please|dekh|dhoond|search)/i.test(
      t
    )
  ) {
    return false;
  }
  if (/\b(qty|quantity|tabs?|cream|syrup|lotion|soap|ml|gm|mg|strip|bottle|order|po\b|purchase)/i.test(t))
    return true;
  if (t.split("\n").length >= 3) return true;
  return t.length > 120;
}

// ---------- Order process ----------
async function processOrder({ text, files }) {
  const parts = [];
  for (const f of files) {
    const p = await fileToModelPart(f);
    if (p) parts.push(p);
  }
  let localText = text || "";
  for (const f of files) {
    try {
      const t = await extractLocalText(f);
      if (t) localText += "\n\n--- " + f.name + " ---\n" + t;
    } catch (_) {}
  }

  const parsed = await geminiParseOrder({ userText: text, localText, parts });
  const rows = (parsed.items || []).map((it) => rowFromItem(it, parsed.party));
  for (const r of rows) applyQtyRules(r);

  // ALWAYS deepen match with master (Chandrika→CHK, plain Alaspan TAB, etc.)
  for (const r of rows) {
    if (r.status === "green" && r.code && r.confidence >= 0.9 && r.note === "learned rule") continue;
    const deep = matchProduct({ poName: r.po_name, pack: r.pack, party: r.party });
    // Prefer seed/rule green; else take better master result
    if (deep.code && (r.status !== "green" || (deep.confidence || 0) > (r.confidence || 0) + 0.05 || deep.note.includes("seed") || deep.note.includes("unique") || deep.note.includes("learned"))) {
      // Don't overwrite a learned rule with weaker yellow
      if (r.status === "green" && r.note === "learned rule" && deep.status !== "green") {
        /* keep */
      } else {
        r.code = deep.code || r.code;
        r.status = deep.status;
        r.master_name = deep.master_name || r.master_name;
        r.confidence = deep.confidence;
        r.note = deep.note || r.note;
        r.candidates = deep.candidates || [];
      }
    }
  }

  // Second pass: force known aliases (Chandrika, etc.) via resolve helpers
  forceKnownAliases(rows);

  // Auto-learn high-confidence matches as soft rules? No — only green with high score optional
  // Auto-save green alias when very strong unique brand match
  let autoLearned = 0;
  for (const r of rows) {
    if (r.status === "green" && r.code && r.confidence >= 0.85 && r.po_name) {
      // never auto-learn suspected wrong alaspan AM for plain TAB
      if (/alaspan/i.test(r.po_name) && String(r.code) === "401353008") continue;
      const existed = state.rules.some(
        (x) => norm(x.pattern) === norm(r.po_name) && norm(x.pack || "") === norm(r.pack || "")
      );
      if (!existed) {
        upsertRule(
          {
            pattern: r.po_name,
            pack: r.pack,
            party: "",
            code: r.code,
            note: "auto from strong match",
          },
          { silent: true }
        );
        autoLearned++;
      }
    }
  }
  if (autoLearned) {
    state.stats.rules_learned = (state.stats.rules_learned || 0) + autoLearned;
    saveStats();
  }

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

  const g = rows.filter((r) => r.status === "green").length;
  const y = rows.filter((r) => r.status === "yellow").length;
  const rd = rows.filter((r) => r.status === "red").length;
  state.stats.orders_processed = (state.stats.orders_processed || 0) + 1;
  state.stats.last_order_green = g;
  state.stats.last_order_total = rows.length;
  saveStats();

  removeTyping();
  renderOrderTable(orderId);

  const weak = rows
    .filter((r) => r.status !== "green")
    .slice(0, 6)
    .map((r, i) => `• ${r.po_name}${r.master_name ? " → ? " + r.master_name.split("|")[0].trim() : ""}`)
    .join("\n");

  addBotText(
    `Parsed ${rows.length} lines. 🟢 ${g} sure · 🟡 ${y} check · 🔴 ${rd} no code.\n` +
      (parsed.party ? `Party: ${parsed.party}\n` : "") +
      (autoLearned ? `Auto-learned ${autoLearned} strong alias rule(s).\n` : "") +
      `Learning now: ${learningPercent()}% · Rules: ${state.rules.length}\n` +
      (weak ? `\nCheck these:\n${weak}\n\nBol: “Benadon master me check kar” ya cell me code likho.` : "\nSab green — Copy Excel ready.")
  );
}

function rowFromItem(it, partyFallback) {
  const poName = String(it.po_name || it.name || "").trim();
  const pack = String(it.pack || "").trim();
  const qty = normalizeQty(it.qty);
  const party = String(it.party || partyFallback || "").trim();
  const match = matchProduct({ poName, pack, party });
  return {
    code: match.code || "",
    qty,
    po_name: poName,
    pack,
    party,
    status: match.status,
    master_name: match.master_name || "",
    confidence: match.confidence || 0,
    note: match.note || "",
    candidates: match.candidates || [],
  };
}

// ---------- Smart chat ----------
async function processChatEdit(text) {
  const order = state.activeOrderId ? state.orders.get(state.activeOrderId) : null;

  // 0) If active order exists, ANY mapping/search chat is LOCAL-FIRST (ChatGPT-useless loops stop here)
  if (order) {
    const mappingIntent =
      /(master|check|file|dhoond|dhundh|dhund|search|dekh|match|map|fill|auto|code|alias|soap|tab|cream|fix|sahi|galat|deep|learn|madat|help|dhundo|find|item)/i.test(
        text
      ) || text.trim().split(/\s+/).length <= 6;

    if (mappingIntent) {
      // Apply known aliases first
      forceKnownAliases(order.rows);
      const forced = autoResolveFromMaster(order, text, { uniqueOnly: false, forceName: extractFocusName(text, order) || text });
      // Also try bare search on every weak row
      for (const row of order.rows) {
        if (row.status === "green" && row.code) continue;
        const cands = rankMasterCandidates(row.po_name, row.pack, 5);
        if (cands.length && (cands[0].score >= 0.55 || isUniqueBrandMatch(row.po_name, cands))) {
          row.code = cands[0].p.code;
          row.status = cands[0].score >= 0.72 || isUniqueBrandMatch(row.po_name, cands) ? "green" : "yellow";
          row.master_name = cands[0].p.name;
          row.confidence = cands[0].score;
          row.note = "chat master";
          row.candidates = cands.map((c) => ({ code: c.p.code, name: c.p.name, score: c.score }));
          if (row.status === "green") {
            upsertRule({ pattern: row.po_name, pack: row.pack, code: row.code, note: "chat master" }, { silent: true });
            bumpStat("rules_learned");
            bumpStat("cells_fixed");
          }
        }
      }
      forceKnownAliases(order.rows);
      const g = order.rows.filter((r) => r.status === "green").length;
      state.stats.last_order_green = g;
      state.stats.last_order_total = order.rows.length;
      saveStats();
      removeTyping();
      document.querySelector(`.table-card[data-oid="${state.activeOrderId}"]`)?.remove();
      renderOrderTable(state.activeOrderId);

      const still = order.rows.filter((r) => r.status !== "green");
      let msg = `Master + AI-local resolve done.\n🟢 ${g}/${order.rows.length} · Rules ${state.rules.length} · Learning ${learningPercent()}%`;
      if (still.length) {
        msg += "\n\nAbhi check:\n" + still
          .slice(0, 8)
          .map((r) => {
            const opts = (r.candidates || []).slice(0, 3).map((c) => c.code).join(", ");
            return `• ${r.po_name} → ${r.code || "?"} ${opts ? "[" + opts + "]" : ""}`;
          })
          .join("\n");
        msg += "\n\nSahi code cell me likho ya: \"ProductName 401283003\"";
      } else {
        msg += "\n\nSab map ho gaya. Copy Excel dabao.";
      }
      // Highlight if Chandrika specifically mentioned
      if (/chandrika|chk/i.test(text)) {
        const ch = order.rows.find((r) => /chandrika|chk/i.test(r.po_name));
        if (ch) msg = `✅ Chandrika → ${ch.code || "?"} (${ch.master_name || "CHK Soap"})\n\n` + msg;
      }
      addBotText(msg);
      return;
    }
  }

  // 1) Fast local intents (no API) — feels instant & smart
  const local = handleLocalIntent(text, order);
  if (local) {
    removeTyping();
    if (local.message) addBotText(local.message);
    if (local.rerender && state.activeOrderId) {
      document.querySelector(`.table-card[data-oid="${state.activeOrderId}"]`)?.remove();
      renderOrderTable(state.activeOrderId);
    }
    return;
  }

  if (!order) {
    // Master-only Q&A via tools
    const hits = searchMaster(text, 8);
    removeTyping();
    if (hits.length) {
      bumpStat("master_lookups");
      addBotText(
        "Master me mila:\n" +
          hits.map((h) => `• ${h.code} — ${h.name}`).join("\n") +
          "\n\nOrder bhejo to table me map kar dunga."
      );
    } else {
      addBotText("Pehle PO bhejo, ya product ka naam clearly likho (jaise BENADON).");
    }
    return;
  }

  // 1b) Always try local master resolve before calling Gemini (prevents dumb "give code" loops)
  if (/master|check|file|dhoond|dhund|search|dekh|match|map|fill|auto|deep|learning|short|chandrika|benadon|alaspan|soap|code/i.test(text)
      || text.trim().split(/\s+/).length <= 4) {
    const forced = autoResolveFromMaster(order, text, { uniqueOnly: false });
    if (forced.updated && /✅|map|Master se/i.test(forced.message)) {
      removeTyping();
      document.querySelector(`.table-card[data-oid="${state.activeOrderId}"]`)?.remove();
      renderOrderTable(state.activeOrderId);
      addBotText(forced.message);
      return;
    }
  }

  // 2) Build master candidates for weak rows for the model
  const weakRows = order.rows
    .map((r, i) => ({ i, r }))
    .filter(({ r }) => r.status !== "green" || !r.code);

  const toolContext = weakRows.slice(0, 12).map(({ i, r }) => {
    const cands = rankMasterCandidates(r.po_name, r.pack, 5).map((c) => ({
      code: c.p.code,
      name: c.p.name,
      score: +c.score.toFixed(2),
    }));
    return { row: i, po_name: r.po_name, pack: r.pack, qty: r.qty, current_code: r.code, candidates: cands };
  });

  const draft = await geminiInterpretEdit({
    message: text,
    rows: order.rows,
    meta: order.meta,
    toolContext,
    masterSize: state.master.length,
  });

  removeTyping();

  // If model returned search-only answer
  if (draft.type === "chat" || draft.type === "info") {
    // If user asked master check but model only talked — force local master resolve
    if (/master|check|file|dhoond|search|dekh|code/i.test(text)) {
      const forced = autoResolveFromMaster(order, text);
      if (forced.updated) {
        document.querySelector(`.table-card[data-oid="${state.activeOrderId}"]`)?.remove();
        renderOrderTable(state.activeOrderId);
        addBotText(forced.message);
        return;
      }
    }
    addBotText(draft.message || "OK");
    return;
  }

  // Apply updates (with confirm only if rules change OR multi-row)
  const rules = draft.rules || (draft.rule ? [draft.rule] : []);
  const updates = draft.row_updates || [];
  const summary = formatDraftSummary(draft);

  let apply = true;
  if (rules.length || updates.length > 3) {
    addBotText("Samajh gaya:\n" + summary);
    apply = await askConfirm(summary + "\n\nApply + save rules?");
    if (!apply) {
      addBotText("Cancel — kuch change nahi hua.");
      return;
    }
  } else if (updates.length) {
    addBotText(draft.message || summary || "Update laga raha hoon…");
  }

  let changed = 0;
  for (const u of updates) {
    const idx = findRowIndex(order.rows, u);
    if (idx < 0) continue;
    const row = order.rows[idx];
    if (u.code != null && String(u.code).trim() !== "") {
      row.code = String(u.code).trim();
      row.status = "green";
      row.note = "chat/master";
      row.master_name = u.master_name || row.master_name;
      changed++;
      // auto rule
      upsertRule(
        {
          pattern: row.po_name,
          pack: row.pack,
          party: row.party || order.meta?.party || "",
          code: row.code,
          note: "from chat",
        },
        { silent: true }
      );
      bumpStat("rules_learned");
      bumpStat("cells_fixed");
    }
    if (u.qty != null && u.qty !== "") row.qty = normalizeQty(u.qty);
    if (u.po_name) row.po_name = String(u.po_name);
    if (u.pack) row.pack = String(u.pack);
  }
  for (const rule of rules) {
    upsertRule(rule, { silent: true });
    bumpStat("rules_learned");
  }

  // recount
  const g = order.rows.filter((r) => r.status === "green").length;
  state.stats.last_order_green = g;
  state.stats.last_order_total = order.rows.length;
  saveStats();

  document.querySelector(`.table-card[data-oid="${state.activeOrderId}"]`)?.remove();
  renderOrderTable(state.activeOrderId);
  addBotText(
    (draft.message ? draft.message + "\n" : "") +
      `Updated ${changed} row(s). 🟢 ${g}/${order.rows.length}. Rules: ${state.rules.length}. Learning: ${learningPercent()}%`
  );
}

/** Local intents without waiting for Gemini */
function handleLocalIntent(text, order) {
  const t = text.trim();
  const lower = t.toLowerCase();

  // Progress
  if (/^(progress|learning|status|kitna|stats)/i.test(t)) {
    return {
      message: `Learning ${learningPercent()}%\nRules: ${state.rules.length}\nOrders: ${state.stats.orders_processed}\nFixes: ${state.stats.cells_fixed}\nMaster: ${state.master.length} products`,
    };
  }

  // Rematch all
  if (order && /(re.?match|dobara match|phir se match|refresh match|auto match)/i.test(t)) {
    for (const r of order.rows) {
      const m = matchProduct({ poName: r.po_name, pack: r.pack, party: r.party });
      r.code = m.code || r.code;
      r.status = m.status;
      r.master_name = m.master_name;
      r.confidence = m.confidence;
      r.note = m.note;
      r.candidates = m.candidates;
    }
    const g = order.rows.filter((x) => x.status === "green").length;
    state.stats.last_order_green = g;
    state.stats.last_order_total = order.rows.length;
    saveStats();
    return {
      rerender: true,
      message: `Rematch done. 🟢 ${g}/${order.rows.length}. Learning ${learningPercent()}%`,
    };
  }

  // Explicit code assignment: "benadon 400016004" or "row 3 code 400016004"
  const codeAssign = t.match(/(?:row\s*)?(\d+)?\s*[:\-]?\s*(.+?)?\s*(?:code\s*)?(?:=|\bis\b|:)?\s*(\d{6,12})\s*$/i);
  if (order && codeAssign && codeAssign[3]) {
    const code = codeAssign[3];
    const rowHint = codeAssign[1] ? Number(codeAssign[1]) - 1 : null;
    const nameHint = (codeAssign[2] || "").replace(/code/gi, "").trim();
    let idx = -1;
    if (rowHint != null && !Number.isNaN(rowHint) && order.rows[rowHint]) idx = rowHint;
    else if (nameHint) idx = findRowIndex(order.rows, { po_name: nameHint });
    else {
      // if only one red/yellow matches last mentioned brand in message
      const brand = brandToken(nameHint || t);
      if (brand) {
        idx = order.rows.findIndex((r) => norm(r.po_name).includes(brand) && r.status !== "green");
        if (idx < 0) idx = order.rows.findIndex((r) => norm(r.po_name).includes(brand));
      }
    }
    if (idx >= 0) {
      const row = order.rows[idx];
      row.code = code;
      row.status = "green";
      row.note = "manual code";
      const m = state.master.find((p) => String(p.code) === code);
      if (m) row.master_name = m.name;
      upsertRule({ pattern: row.po_name, pack: row.pack, code, note: "user code" }, { silent: true });
      bumpStat("rules_learned");
      bumpStat("cells_fixed");
      return {
        rerender: true,
        message: `✅ ${row.po_name} → ${code}${m ? " (" + m.name + ")" : ""}\nRule saved. Learning ${learningPercent()}%`,
      };
    }
  }

  // "only one / ek hi hai" + product name → pick unique master brand hit
  if (order && /(ek hi|only one|sirf ek|single|unique|ek hi hai)/i.test(t)) {
    const res = autoResolveFromMaster(order, t, { uniqueOnly: true });
    if (res.updated) return { rerender: true, message: res.message };
  }

  // master check / file me dekh / dhoond
  if (order && /(master|file me|check kar|dhoond|search|dekh|map kar|fill|auto)/i.test(t)) {
    const res = autoResolveFromMaster(order, t, { uniqueOnly: false });
    if (res.updated) return { rerender: true, message: res.message };
    // show candidates
    const focus = extractFocusName(t, order);
    if (focus) {
      const cands = rankMasterCandidates(focus, "", 6);
      bumpStat("master_lookups");
      if (cands.length) {
        return {
          message:
            `"${focus}" master options:\n` +
            cands.map((c, i) => `${i + 1}. ${c.p.code} — ${c.p.name} (${c.score.toFixed(2)})`).join("\n") +
            `\n\nLikho: "${focus} ${cands[0].p.code}" ya serial number se choose.`,
        };
      }
      return { message: `"${focus}" master me nahi mila. Naam thoda aur clear likho.` };
    }
  }

  // choose option number "1" when last weak row?
  if (order && /^\s*[1-6]\s*$/.test(t)) {
    const n = Number(t.trim()) - 1;
    const weak = order.rows.find((r) => r.status !== "green" && r.candidates?.length);
    if (weak && weak.candidates[n]) {
      const c = weak.candidates[n];
      weak.code = c.code;
      weak.status = "green";
      weak.master_name = c.name;
      weak.note = "picked option";
      upsertRule({ pattern: weak.po_name, pack: weak.pack, code: c.code, note: "option pick" }, { silent: true });
      bumpStat("rules_learned");
      bumpStat("cells_fixed");
      return {
        rerender: true,
        message: `✅ ${weak.po_name} → ${c.code} (${c.name})\nRule saved. Learning ${learningPercent()}%`,
      };
    }
  }

  // Bare product name / short Hinglish → ALWAYS search master (no dumb "give me code")
  if (order && t.length >= 3 && t.length <= 80) {
    const res = autoResolveFromMaster(order, t, { uniqueOnly: false, forceName: t });
    if (res.updated) return { rerender: true, message: res.message };
    // still show master hits for the typed word
    const hits = searchMaster(t, 8);
    if (hits.length) {
      bumpStat("master_lookups");
      // try map onto matching order rows by brand
      const b = brandToken(t);
      let mapped = 0;
      if (hits.length === 1 || (b && hits.filter((h) => brandToken(h.name) === b || norm(h.name).includes("chk")).length === 1)) {
        const pick = hits.length === 1 ? hits[0] : hits.find((h) => norm(h.name).includes("chk")) || hits[0];
        for (const row of order.rows) {
          if (row.status === "green" && row.code) continue;
          const rb = brandToken(row.po_name);
          if (
            norm(row.po_name).includes(norm(t)) ||
            norm(t).includes(rb) ||
            rb === b ||
            (b === "chk" && /chandrika|chk|soap/i.test(row.po_name)) ||
            (/chandrika|chk/i.test(t) && /chandrika|chk|soap/i.test(row.po_name))
          ) {
            row.code = pick.code;
            row.status = "green";
            row.master_name = pick.name;
            row.note = "name→master";
            upsertRule({ pattern: row.po_name, pack: row.pack, code: pick.code, note: "chat name" }, { silent: true });
            mapped++;
            bumpStat("rules_learned");
            bumpStat("cells_fixed");
          }
        }
        if (mapped) {
          const g = order.rows.filter((r) => r.status === "green").length;
          state.stats.last_order_green = g;
          state.stats.last_order_total = order.rows.length;
          saveStats();
          return {
            rerender: true,
            message: `✅ Master se map: ${pick.code} — ${pick.name}\n${mapped} row(s) updated · 🟢 ${g}/${order.rows.length} · Learning ${learningPercent()}%`,
          };
        }
      }
      return {
        message:
          `Master me "${t}" ke results:\n` +
          hits.map((h, i) => `${i + 1}. ${h.code} — ${h.name}`).join("\n") +
          `\n\nLikho: "Chandrika ${hits[0].code}" ya sirf code number, ya option 1.`,
      };
    }
  }

  return null;
}

function extractFocusName(text, order) {
  // remove command words
  let s = text
    .replace(/(master|file|me|check|kar|karke|dhoond|search|dekh|lo|do|please|pls|code|auto|map|fill|ek hi|hai|only|one|sirf|unique|product|item|row)/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (s.length >= 3) return s;
  // fallback: first non-green row
  if (order) {
    const w = order.rows.find((r) => r.status !== "green");
    if (w) return w.po_name;
  }
  return "";
}

function autoResolveFromMaster(order, text, { uniqueOnly = false, forceName = "" } = {}) {
  const focus = forceName || extractFocusName(text, order);
  const targets = [];
  if (focus) {
    const nf = norm(focus);
    const fb = brandToken(focus);
    for (let i = 0; i < order.rows.length; i++) {
      const r = order.rows[i];
      const rn = norm(r.po_name);
      const rb = brandToken(r.po_name);
      if (
        rn.includes(nf) ||
        nf.includes(rn) ||
        nf.includes(rb) ||
        rb === fb ||
        // Chandrika ↔ CHK soap
        ((/chandrika|chk/.test(nf) || fb === "chk") && /chandrika|chk|soap/.test(rn)) ||
        (/chandrika|chk/.test(rn) && (/chandrika|chk/.test(nf) || fb === "chk"))
      ) {
        targets.push(i);
      }
    }
  }
  if (!targets.length) {
    // all weak rows
    order.rows.forEach((r, i) => {
      if (r.status !== "green" || !r.code) targets.push(i);
    });
  }
  if (!targets.length && focus) {
    // still try brand across all
    order.rows.forEach((r, i) => {
      if (brandToken(r.po_name) && brandToken(focus) === brandToken(r.po_name)) targets.push(i);
    });
  }

  let updated = 0;
  const lines = [];
  bumpStat("master_lookups");

  for (const i of [...new Set(targets)]) {
    const row = order.rows[i];
    const cands = rankMasterCandidates(row.po_name || focus, row.pack, 6);
    row.candidates = cands.map((c) => ({ code: c.p.code, name: c.p.name, score: c.score }));
    if (!cands.length) {
      lines.push(`• ${row.po_name}: master me nahi mila`);
      continue;
    }
    const top = cands[0];
    const second = cands[1];
    const uniqueBrand = isUniqueBrandMatch(row.po_name, cands);
    const clear =
      top.score >= 0.72 ||
      uniqueBrand ||
      (top.score >= 0.55 && (!second || top.score - second.score >= 0.12));

    if (uniqueOnly && !uniqueBrand && cands.length > 1 && top.score < 0.9) {
      lines.push(
        `• ${row.po_name}: ${cands.length} options — ` +
          cands
            .slice(0, 3)
            .map((c) => c.p.code)
            .join(", ")
      );
      continue;
    }

    if (clear || uniqueOnly && uniqueBrand) {
      row.code = top.p.code;
      row.status = "green";
      row.master_name = top.p.name;
      row.confidence = top.score;
      row.note = uniqueBrand ? "unique brand in master" : "master check";
      upsertRule(
        { pattern: row.po_name, pack: row.pack, code: top.p.code, note: "master resolve" },
        { silent: true }
      );
      updated++;
      bumpStat("rules_learned");
      bumpStat("cells_fixed");
      lines.push(`✅ ${row.po_name} → ${top.p.code} (${top.p.name})`);
    } else {
      row.code = top.p.code;
      row.status = "yellow";
      row.master_name = cands
        .slice(0, 3)
        .map((c) => c.p.name)
        .join(" | ");
      row.note = "verify options";
      lines.push(
        `🟡 ${row.po_name} → ${top.p.code}? options:\n` +
          cands
            .slice(0, 4)
            .map((c, idx) => `   ${idx + 1}. ${c.p.code} — ${c.p.name}`)
            .join("\n")
      );
    }
  }

  const g = order.rows.filter((r) => r.status === "green").length;
  state.stats.last_order_green = g;
  state.stats.last_order_total = order.rows.length;
  saveStats();

  return {
    updated: updated > 0 || lines.length > 0,
    message:
      (updated ? `Master se ${updated} code map kiye.\n` : "Master check:\n") +
      lines.join("\n") +
      `\n\n🟢 ${g}/${order.rows.length} · Rules ${state.rules.length} · Learning ${learningPercent()}%`,
  };
}

function isUniqueBrandMatch(poName, cands) {
  const b = brandToken(poName);
  if (!b || !cands.length) return false;
  const same = state.master.filter((p) => brandToken(p.name) === b);
  // unique product under brand in master
  if (same.length === 1 && brandToken(cands[0].p.name) === b) return true;
  // all top candidates same code
  if (cands.length >= 1 && cands.every((c) => c.p.code === cands[0].p.code)) return true;
  // only one master row contains brand
  return same.length === 1;
}

function findRowIndex(rows, u) {
  if (typeof u.row === "number" && u.row >= 0 && u.row < rows.length) return u.row;
  if (u.po_name) {
    const n = norm(u.po_name);
    let i = rows.findIndex((r) => norm(r.po_name) === n);
    if (i >= 0) return i;
    i = rows.findIndex((r) => norm(r.po_name).includes(n) || n.includes(norm(r.po_name)));
    if (i >= 0) return i;
    const b = brandToken(u.po_name);
    if (b) {
      i = rows.findIndex((r) => brandToken(r.po_name) === b);
      if (i >= 0) return i;
    }
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
      lines.push(`  • row ${u.row ?? "?"} ${u.po_name || ""} → ${u.code ?? "—"} qty=${u.qty ?? "—"}`);
    }
  }
  const rules = draft.rules || (draft.rule ? [draft.rule] : []);
  if (rules.length) {
    lines.push("Rules:");
    for (const r of rules) {
      lines.push(`  • ${r.pattern || ""} ${r.pack || ""} → ${r.code || ""}`);
    }
  }
  return lines.join("\n") || "updates";
}

function upsertRule(rule, { silent = false } = {}) {
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
    id: idx >= 0 ? state.rules[idx].id : "r_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6),
    pattern,
    party,
    pack,
    pack_exclude: String(rule.pack_exclude || "").trim(),
    code: rule.code != null ? String(rule.code).trim() : idx >= 0 ? state.rules[idx].code : "",
    qty_multiple:
      rule.qty_multiple != null
        ? Number(rule.qty_multiple) || null
        : idx >= 0
          ? state.rules[idx].qty_multiple
          : null,
    note: rule.note || "",
    updated_at: new Date().toISOString(),
  };
  if (!row.code) return;
  if (idx >= 0) state.rules[idx] = { ...state.rules[idx], ...row };
  else state.rules.push(row);
  saveRules();
  if (!silent) {
    /* optional toast */
  }
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

// ---------- Table ----------
function renderOrderTable(orderId) {
  const order = state.orders.get(orderId);
  if (!order) return;

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

  const meta = order.meta || {};
  const g = order.rows.filter((r) => r.status === "green").length;
  card.innerHTML = `
    <div class="table-toolbar">
      <span class="title">${escapeHtml(meta.party || "Order")}${
    meta.order_no ? " · #" + escapeHtml(String(meta.order_no)) : ""
  } · ${g}/${order.rows.length}</span>
      <span class="badge on">ACTIVE</span>
      <button type="button" class="btn ghost btn-fixall">Fix All</button>
      <button type="button" class="btn ghost btn-rematch">Rematch</button>
      <button type="button" class="btn ghost btn-copy-codes">Codes</button>
      <button type="button" class="btn ghost btn-copy-qty">Qty</button>
      <button type="button" class="btn ghost btn-copy-names">Names</button>
      <button type="button" class="btn primary btn-copy-tsv">Copy Excel</button>
    </div>
    <div class="table-scroll">
      <table class="order-table">
        <thead><tr>
          <th class="row-status"></th>
          <th>Code</th>
          <th>Qty</th>
          <th>PO Name</th>
        </tr></thead>
        <tbody></tbody>
      </table>
    </div>`;

  const tbody = card.querySelector("tbody");
  order.rows.forEach((row, idx) => {
    const tr = document.createElement("tr");
    tr.dataset.idx = idx;
    tr.innerHTML = `
      <td class="row-status"><span class="st-${row.status || "red"}"></span></td>
      <td class="cell code" contenteditable="true" spellcheck="false"></td>
      <td class="cell qty" contenteditable="true" spellcheck="false"></td>
      <td class="cell po-name" contenteditable="true" spellcheck="false"></td>`;
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
    tr.querySelectorAll(".cell").forEach((cell) => {
      cell.addEventListener("focus", () => {
        if (cell.classList.contains("po-name")) cell.textContent = row.po_name || "";
      });
      cell.addEventListener("blur", () => onCellEdit(orderId, idx, cell));
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
    copyText(header + "\n" + body, "Excel ke liye copy ho gaya");
  };
  card.querySelector(".btn-rematch").onclick = () => {
    for (const r of order.rows) {
      const m = matchProduct({ poName: r.po_name, pack: r.pack, party: r.party });
      Object.assign(r, {
        code: m.code || "",
        status: m.status,
        master_name: m.master_name,
        confidence: m.confidence,
        note: m.note,
        candidates: m.candidates,
      });
    }
    forceKnownAliases(order.rows);
    const g2 = order.rows.filter((r) => r.status === "green").length;
    state.stats.last_order_green = g2;
    state.stats.last_order_total = order.rows.length;
    saveStats();
    card.remove();
    renderOrderTable(orderId);
    addBotText(`Rematch: 🟢 ${g2}/${order.rows.length}`);
  };
  card.querySelector(".btn-fixall").onclick = () => {
    forceKnownAliases(order.rows);
    for (const r of order.rows) {
      const m = matchProduct({ poName: r.po_name, pack: r.pack, party: r.party });
      if (m.code) {
        r.code = m.code;
        r.status = m.status === "red" ? "yellow" : m.status;
        r.master_name = m.master_name;
        r.confidence = m.confidence;
        r.note = m.note || "fix all";
        r.candidates = m.candidates;
        if (r.status === "green") {
          upsertRule({ pattern: r.po_name, pack: r.pack, code: r.code, note: "fix all" }, { silent: true });
        }
      }
    }
    forceKnownAliases(order.rows);
    const g2 = order.rows.filter((r) => r.status === "green").length;
    state.stats.last_order_green = g2;
    state.stats.last_order_total = order.rows.length;
    saveStats();
    card.remove();
    renderOrderTable(orderId);
    addBotText(`Fix All (master): 🟢 ${g2}/${order.rows.length} · Learning ${learningPercent()}%`);
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
  if (cell.classList.contains("po-name")) raw = raw.split("\n")[0].trim();

  if (cell.classList.contains("code")) {
    if (raw !== String(row.code || "")) {
      row.code = raw;
      row.status = raw ? "green" : "red";
      row.note = "manual edit";
      const m = state.master.find((p) => String(p.code) === raw);
      if (m) row.master_name = m.name;
      refreshRowDom(orderId, idx);
      if (raw) {
        const ok = await askConfirm(`Save rule?\n\n"${row.po_name}" ${row.pack || ""}\n→ ${raw}`);
        if (ok) {
          upsertRule({ pattern: row.po_name, pack: row.pack, party: row.party, code: raw, note: "cell" });
          bumpStat("rules_learned");
          bumpStat("cells_fixed");
          addBotText(`Rule saved: ${row.po_name} → ${raw} · Learning ${learningPercent()}%`);
        }
      }
    }
  } else if (cell.classList.contains("qty")) {
    row.qty = normalizeQty(raw);
    refreshRowDom(orderId, idx);
  } else if (cell.classList.contains("po-name")) {
    if (raw !== row.po_name) {
      row.po_name = raw;
      const m = matchProduct({ poName: raw, pack: row.pack, party: row.party });
      if (m.code) {
        row.code = m.code;
        row.status = m.status;
        row.master_name = m.master_name;
      }
      refreshRowDom(orderId, idx);
    }
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
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }
  addBotText(okMsg || "Copied");
}

// ---------- Matching engine (strong) ----------
const STOP = new Set(
  "the and for of with tab tabs tablet tablets strip cream lotion syrup syp soap ml gm g mg bottle pack pcs of in on a an ta s t".split(
    " "
  )
);

// common PO name → master brand aliases
const ALIAS_BRAND = {
  chandrika: "chk",
  chandirka: "chk",
  "chandrika soap": "chk",
  chk: "chk",
  "chk soap": "chk",
  sloan: "sloans",
  sloans: "sloans",
  "sloans kills pain": "sloans",
  "kills pain liniment": "sloans",
  "lacto calamine": "lc",
  lactocalamine: "lc",
  "lc face": "lc",
  "lc face lotion": "lc",
  caladryl: "caladryl",
  glucovita: "glucovita",
  naturolax: "naturolax",
  "naturolax-a": "naturolax",
  mycospor: "mycospor",
  canesten: "canesten",
  alaspan: "alaspan",
  benadon: "benadon",
  digeplex: "digeplex",
  "digeplex t": "digeplex",
  ferradol: "ferradol",
  supradyn: "supradyn",
  neko: "neko",
  littles: "littles",
  becozyn: "becozym",
  becozym: "becozym",
  tetmosol: "tetmosol",
  "i-pill": "i",
  ipill: "i",
};

/** Hard PO phrase → preferred material code (seed memory) */
const SEED_ALIASES = [
  { pattern: "CHANDRIKA SOAP", pack: "75GM", code: "401283003", note: "CHK Soap 75g" },
  { pattern: "CHANDRIKA SOAP", pack: "75", code: "401283003", note: "CHK Soap 75g" },
  { pattern: "CHANDRIKA", pack: "", code: "401283003", note: "CHK Soap 75g" },
  { pattern: "ALASPAN TAB", pack: "10TAB", code: "401353005", note: "Alaspan Tablets-Strip Of 10" },
  { pattern: "ALASPAN TAB", pack: "10", code: "401353005", note: "Alaspan Tablets-Strip Of 10" },
  { pattern: "ALASPAN TABS", pack: "", code: "401353005", note: "Alaspan Tablets-Strip Of 10" },
  { pattern: "BENADON 40MG TAB", pack: "15TAB", code: "400016004", note: "BENADON TABLETS 15T" },
  { pattern: "BENADON", pack: "15", code: "400016004", note: "BENADON TABLETS 15T" },
  { pattern: "CANESTEN S CREAM", pack: "15GM", code: "401376004", note: "Canesten S Cream 15G" },
  { pattern: "MYCOSPOR CREAM", pack: "30GM", code: "401379001", note: "Mycospor" },
  { pattern: "DIGEPLEX T TAB", pack: "10TAB", code: "401285008", note: "Digeplex-T Tablet 10S" },
  { pattern: "FERRADOL", pack: "200GM", code: "401220002", note: "Ferradol 200G" },
  { pattern: "SLOANS KILLS PAIN LINIMENT", pack: "71ML", code: "401210003", note: "Sloans Liniment 71ml" },
  { pattern: "SLOANS LINIMENT", pack: "71ML", code: "401210003", note: "Sloans Liniment 71ml" },
  { pattern: "SUPRADYN DAILY BOTTLE TAB", pack: "60TAB", code: "400134046", note: "Supradyn Daily 60s" },
  { pattern: "SUPRADYN DAILY", pack: "60", code: "400134046", note: "Supradyn Daily 60s" },
  { pattern: "NEKO DAILY HYGIENE SOAP", pack: "100GM", code: "401179500", note: "Neko Daily Hygiene Soap" },
  { pattern: "CALADRYL LOTION", pack: "65ML", code: "401114015", note: "Caladryl Lotion 65Ml" },
  { pattern: "CALADRYL LOTION", pack: "125ML", code: "401114016", note: "Caladryl Lotion 125Ml" },
];


function purgeBadRules() {
  const before = state.rules.length;
  state.rules = state.rules.filter((r) => {
    // plain Alaspan TAB must not point to AM code
    if (/alaspan/i.test(r.pattern || "") && !/am/i.test(r.pattern || "") && String(r.code) === "401353008") return false;
    return true;
  });
  // ensure Chandrika seed always present
  if (!state.rules.some((r) => /chandrika/i.test(r.pattern || "") && r.code === "401283003")) {
    state.rules.push({
      id: "seed_chandrika",
      pattern: "CHANDRIKA SOAP",
      pack: "75GM",
      party: "",
      pack_exclude: "",
      code: "401283003",
      qty_multiple: null,
      note: "seed",
      updated_at: new Date().toISOString(),
    });
  }
  if (state.rules.length !== before) saveRules();
  else saveRules();
}

function seedAliasRules() {
  let added = 0;
  for (const s of SEED_ALIASES) {
    const exists = state.rules.some(
      (r) => norm(r.pattern) === norm(s.pattern) && norm(r.pack || "") === norm(s.pack || "") && r.code === s.code
    );
    if (exists) continue;
    // don't overwrite user rule with different code for same pattern+pack
    const user = state.rules.find(
      (r) => norm(r.pattern) === norm(s.pattern) && norm(r.pack || "") === norm(s.pack || "")
    );
    if (user && user.code && user.note !== "seed") continue;
    upsertRule({ ...s, note: s.note || "seed" }, { silent: true });
    added++;
  }
  return added;
}


/** Hard deterministic fixes the scorer must never miss */
function forceKnownAliases(rows) {
  const fixes = [
    {
      test: (r) => /chandrika/i.test(r.po_name) || (brandToken(r.po_name) === "chk" && /soap/i.test(r.po_name)),
      code: "401283003",
      master_name: "CHK Soap 75g",
    },
    {
      test: (r) => /alaspan/i.test(r.po_name) && /tab/i.test(r.po_name + " " + r.pack) && !/am|ag|syrup|syp/i.test(r.po_name),
      code: "401353005",
      master_name: "Alaspan Tablets-Strip Of 10 Ta",
    },
    {
      test: (r) => /benadon/i.test(r.po_name),
      code: "400016004",
      master_name: "BENADON TABLETS 15T",
    },
    {
      test: (r) => /canesten\s*s/i.test(r.po_name) && /15/i.test(r.po_name + r.pack),
      code: "401376004",
      master_name: "Canesten S Cream 15G In",
    },
    {
      test: (r) => /mycospor/i.test(r.po_name),
      code: "401379001",
      master_name: "Mycospor 1% Crea 1X30 G In",
    },
    {
      test: (r) => /digeplex\s*t/i.test(r.po_name) && /tab/i.test(r.po_name + r.pack),
      code: "401285008",
      master_name: "Digeplex-T Tablet 10S",
    },
    {
      test: (r) => /^ferradol/i.test(r.po_name.trim()) && /200/i.test(r.po_name + r.pack),
      code: "401220002",
      master_name: "Ferradol 200G",
    },
    {
      test: (r) => /sloan/i.test(r.po_name) && /liniment|71/i.test(r.po_name + r.pack),
      code: "401210003",
      master_name: "Sloans Pain Relief Liniment 71ml",
    },
    {
      test: (r) => /supradyn/i.test(r.po_name) && /daily/i.test(r.po_name) && /60/i.test(r.po_name + r.pack),
      code: "400134046",
      master_name: "SUPRADYN DAILY TABLETS 60'S BOTTLE",
    },
  ];
  for (const r of rows) {
    for (const f of fixes) {
      if (!f.test(r)) continue;
      // verify code exists in master
      const m = state.master.find((p) => String(p.code) === f.code);
      if (!m && state.master.length) continue;
      r.code = f.code;
      r.status = "green";
      r.master_name = (m && m.name) || f.master_name;
      r.confidence = 1;
      r.note = "known alias";
      upsertRule(
        { pattern: r.po_name, pack: r.pack, code: f.code, note: "known alias" },
        { silent: true }
      );
      break;
    }
  }
}

function matchProduct({ poName, pack, party }) {
  const nPo = norm(poName);
  const nPack = norm(pack);
  if (!nPo) return { status: "red", code: "", note: "empty name" };

  // 0) Deterministic known products (never miss Chandrika / plain Alaspan TAB)
  if (/chandrika/.test(nPo)) {
    return { status: "green", code: "401283003", master_name: "CHK Soap 75g", confidence: 1, note: "known alias", candidates: [] };
  }
  if (/alaspan/.test(nPo) && /tab/.test(nPo + nPack) && !/\bam\b|\bag\b|syrup|syp/.test(nPo)) {
    return { status: "green", code: "401353005", master_name: "Alaspan Tablets-Strip Of 10 Ta", confidence: 1, note: "known alias", candidates: [] };
  }
  if (/benadon/.test(nPo)) {
    return { status: "green", code: "400016004", master_name: "BENADON TABLETS 15T", confidence: 1, note: "known alias", candidates: [] };
  }

  // Seed alias table
  for (const s of SEED_ALIASES) {
    const sp = norm(s.pattern);
    if (!sp) continue;
    if (!(nPo === sp || nPo.includes(sp) || sp.includes(nPo) || tokenScore(nPo, sp) > 0.85)) continue;
    if (s.pack) {
      const pk = norm(s.pack);
      if (nPack && !(nPack.includes(pk) || pk.includes(nPack) || packLooseEqual(nPack, pk))) {
        // pack mismatch — allow if pattern is strong exact brand phrase
        if (!(nPo === sp || nPo.startsWith(sp))) continue;
      }
    }
    return {
      status: "green",
      code: s.code,
      master_name: s.note || "seed",
      confidence: 0.99,
      note: "seed alias",
      candidates: [],
    };
  }

  // 1) Rules
  let bestRule = null;
  let bestRuleScore = 0;
  for (const r of state.rules) {
    const rp = norm(r.pattern);
    if (!rp) continue;
    let score = 0;
    if (nPo === rp) score = 100;
    else if (nPo.includes(rp) || rp.includes(nPo)) score = 86;
    else score = tokenScore(nPo, rp) * 75;
    if (r.pack) {
      const rpk = norm(r.pack);
      if (nPack && (nPack.includes(rpk) || rpk.includes(nPack) || packLooseEqual(nPack, rpk))) score += 12;
      else if (nPack) score -= 20;
    }
    if (score > bestRuleScore) {
      bestRuleScore = score;
      bestRule = r;
    }
  }
  if (bestRule && bestRuleScore >= 78 && bestRule.code) {
    return {
      status: "green",
      code: bestRule.code,
      master_name: bestRule.note || "rule",
      confidence: bestRuleScore / 100,
      note: "learned rule",
      candidates: [],
    };
  }

  // 2) Master rank
  const cands = rankMasterCandidates(poName, pack, 8);
  if (!cands.length) {
    if (bestRule && bestRule.code && bestRuleScore >= 55) {
      return {
        status: "yellow",
        code: bestRule.code,
        master_name: "weak rule",
        confidence: bestRuleScore / 100,
        note: "weak rule",
        candidates: [],
      };
    }
    return { status: "red", code: "", note: "no match", confidence: 0, candidates: [] };
  }

  const top = cands[0];
  const second = cands[1];
  const unique = isUniqueBrandMatch(poName, cands);
  const gap = second ? top.score - second.score : 1;
  const candidates = cands.map((c) => ({ code: c.p.code, name: c.p.name, score: c.score }));

  if ((top.score >= 0.78 && gap >= 0.08) || (unique && top.score >= 0.5) || top.score >= 0.9) {
    return {
      status: "green",
      code: top.p.code,
      master_name: top.p.name,
      confidence: top.score,
      note: unique ? "unique brand" : "",
      candidates,
    };
  }
  if (top.score >= 0.48) {
    return {
      status: "yellow",
      code: top.p.code,
      master_name: cands
        .slice(0, 3)
        .map((c) => c.p.name)
        .join(" | "),
      confidence: top.score,
      note: gap < 0.1 ? "ambiguous" : "check",
      candidates,
    };
  }
  return {
    status: "red",
    code: "",
    master_name: top.p.name,
    confidence: top.score,
    note: "low score",
    candidates,
  };
}

function rankMasterCandidates(poName, pack, limit = 6) {
  if (!state.master.length) return [];
  const nPo = norm(poName);
  const nPack = norm(pack || "");
  const b = brandToken(poName);
  let pool = state.master;
  if (b && state.brandIndex.has(b)) {
    const branded = state.brandIndex.get(b);
    // also include alias brand pool
    pool = branded.length ? branded : state.master;
  }
  // if alias maps elsewhere
  for (const [k, v] of Object.entries(ALIAS_BRAND)) {
    if (nPo.includes(k) && state.brandIndex.has(v)) {
      pool = [...state.brandIndex.get(v)];
      break;
    }
  }

  const out = [];
  // always score full master if pool small mismatch
  const scoreList = (list) => {
    for (const p of list) {
      let score = tokenScore(nPo, norm(p.name));
      const pb = brandToken(p.name);
      const mn = norm(p.name);
      if (b && pb && b === pb) score += 0.28;
      // substring brand
      if (b && mn.includes(b)) score += 0.12;
      // Chandrika PO → CHK Soap
      if (/chandrika/.test(nPo) && (mn.includes("chk") || mn.includes("chandrika"))) score += 0.55;
      if (/chandrika/.test(nPo) && mn.includes("soap") && (nPack.includes("75") || /75/.test(nPo))) score += 0.25;
      // Plain ALASPAN TAB (not AM/AG) → prefer plain tablets 401353005 style, not AM
      if (/alaspan/.test(nPo) && /\btab/.test(nPo) && !/\bam\b|\bag\b|syrup/.test(nPo)) {
        if (mn.includes("alaspan") && mn.includes("tablet") && !mn.includes(" am ") && !mn.includes("ag ")) score += 0.35;
        if (mn.includes(" am ") || mn.includes("alaspan am")) score -= 0.4;
        if (mn.includes("syrup") || mn.includes("ag syrup")) score -= 0.5;
      }
      // pack / size
      if (nPack) {
        const packNums = nPack.match(/\d+/g) || [];
        if (packNums.some((num) => mn.includes(num))) score += 0.14;
        if (packLooseEqual(nPack.replace(/\s/g, ""), mn.replace(/\s/g, ""))) score += 0.1;
        if (isTab(nPo, nPack) && isSyrupName(mn)) score -= 0.45;
        if (isSyrup(nPo, nPack) && isTabName(mn)) score -= 0.45;
        if (isTab(nPo, nPack) && isTabName(mn)) score += 0.1;
        if (/cream|crea/.test(nPo + nPack) && /cream|crea/.test(mn)) score += 0.1;
        if (/lotion/.test(nPo) && /lotion/.test(mn)) score += 0.1;
        if (/soap/.test(nPo) && /soap/.test(mn)) score += 0.12;
        if (/liniment|sloan/.test(nPo) && /liniment|sloan/.test(mn)) score += 0.15;
      } else {
        if (isTab(nPo, "") && isSyrupName(mn)) score -= 0.35;
        if (isSyrup(nPo, "") && isTabName(mn)) score -= 0.35;
      }
      // mg strength
      const mg = (nPo + " " + nPack).match(/(\d+)\s*mg/);
      if (mg && norm(p.name).includes(mg[1])) score += 0.08;
      if (score >= 0.28) out.push({ p, score });
    }
  };
  scoreList(pool);
  // if weak, search full master
  out.sort((a, b) => b.score - a.score);
  if (!out.length || out[0].score < 0.45) {
    out.length = 0;
    scoreList(state.master);
    out.sort((a, b) => b.score - a.score);
  }
  // unique by code
  const seen = new Set();
  const uniq = [];
  for (const c of out) {
    if (seen.has(c.p.code)) continue;
    seen.add(c.p.code);
    uniq.push(c);
    if (uniq.length >= limit) break;
  }
  return uniq;
}

function searchMaster(query, limit = 8) {
  const q = norm(query);
  if (!q) return [];
  const qb = brandToken(query);
  const scored = [];
  for (const p of state.master) {
    const pn = norm(p.name);
    let s = tokenScore(q, pn);
    if (pn.includes(q)) s += 0.3;
    if (String(p.code).includes(query.trim())) s += 0.5;
    if (qb && (brandToken(p.name) === qb || pn.includes(qb))) s += 0.35;
    if (/chandrika/.test(q) && (pn.includes("chk") || pn.includes("chandrika"))) s += 0.7;
    if (/chandrika/.test(q) && pn.includes("soap") && pn.includes("75")) s += 0.3;
    if (s >= 0.25) scored.push({ ...p, _s: s });
  }
  scored.sort((a, b) => b._s - a._s);
  return scored.slice(0, limit);
}

function applyQtyRules(row) {
  const nPo = norm(row.po_name);
  for (const r of state.rules) {
    if (!r.qty_multiple) continue;
    const rp = norm(r.pattern);
    if (!rp) continue;
    if (!(nPo.includes(rp) || rp.includes(nPo) || tokenScore(nPo, rp) > 0.7)) continue;
    const m = Number(r.qty_multiple);
    if (m > 1 && row.qty != null && Number(row.qty) % m !== 0) {
      row.note = (row.note ? row.note + " · " : "") + `qty should be ×${m}`;
      if (row.status === "green") row.status = "yellow";
    }
  }
}

// ---------- Gemini ----------
async function geminiParseOrder({ userText, localText, parts }) {
  // send smarter master slice: brands present in text
  const textAll = (userText || "") + "\n" + (localText || "");
  const brands = new Set();
  for (const p of state.master) {
    const b = brandToken(p.name);
    if (b && norm(textAll).includes(b)) brands.add(b);
  }
  for (const k of Object.keys(ALIAS_BRAND)) {
    if (norm(textAll).includes(k)) brands.add(ALIAS_BRAND[k]);
  }
  let masterHint = [];
  for (const b of brands) {
    const list = state.brandIndex.get(b) || [];
    for (const p of list.slice(0, 12)) masterHint.push(`${p.code}|${p.name}`);
  }
  if (masterHint.length < 30) {
    masterHint = masterHint.concat(state.master.slice(0, 60).map((p) => `${p.code}|${p.name}`));
  }
  masterHint = [...new Set(masterHint)].slice(0, 120).join("\n");

  const sys = `Extract purchase order lines from messy distributor POs.
Return ONLY JSON:
{
  "party": "",
  "order_no": "",
  "order_date": "",
  "items": [ { "po_name": "exact PO product text", "pack": "size/pack", "qty": number } ]
}
Rules:
- Keep distributor product wording in po_name.
- qty = main order qty (number).
- Do NOT invent material codes.
- Skip headers/totals/addresses.
- Read every product line.`;

  const userParts = [
    {
      text:
        sys +
        "\n\nUser message:\n" +
        (userText || "(attachments)") +
        "\n\nExtracted text:\n" +
        truncate(localText || "", 100000) +
        "\n\nMaster catalog excerpt (context only):\n" +
        masterHint,
    },
  ];
  for (const p of parts) userParts.push(p);

  const data = await geminiRequest({
    contents: [{ role: "user", parts: userParts }],
    generationConfig: { temperature: 0.05, responseMimeType: "application/json" },
  });
  const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "";
  const json = safeJson(text);
  if (!json || !Array.isArray(json.items)) {
    throw new Error("Order parse fail. Clearer PDF/photo or paste text try karo.");
  }
  return json;
}

async function geminiInterpretEdit({ message, rows, meta, toolContext, masterSize }) {
  const snapshot = rows.map((r, i) => ({
    row: i,
    code: r.code,
    qty: r.qty,
    po_name: r.po_name,
    pack: r.pack,
    status: r.status,
  }));

  const prompt = `You are Mohan Order Creater brain. User fixes PO↔master mapping in Hinglish/English.
Master has ${masterSize} products. You MUST use provided candidates (from local master search). NEVER invent codes not in candidates or current rows.

Active order meta: ${JSON.stringify(meta)}
Rows: ${JSON.stringify(snapshot)}
Master candidates for weak rows: ${JSON.stringify(toolContext)}

User: ${JSON.stringify(message)}

If user says check master / ek hi hai / map / fix Benadon etc:
- pick best candidate code for matching rows
- emit row_updates + rules (pattern=po_name)

Return ONLY JSON:
{
  "type": "edit" | "chat",
  "message": "short Hinglish summary of what you did",
  "row_updates": [ { "row": 0, "po_name": "", "code": "", "qty": null, "master_name": "" } ],
  "rules": [ { "pattern": "BENADON 40MG TAB", "pack": "15TAB", "code": "400016004", "note": "" } ]
}
If only a question with no change, type=chat.`;

  const data = await geminiRequest({
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.1, responseMimeType: "application/json" },
  });
  const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "";
  return safeJson(text) || { type: "chat", message: text || "Samajh nahi aaya." };
}

async function geminiRequest({ contents, generationConfig }) {
  let model = resolveModel(state.model || "gemini-3.6-flash");
  state.model = model;
  const urlFor = (m) =>
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(m)}:generateContent?key=${encodeURIComponent(state.apiKey)}`;

  let res = await fetch(urlFor(model), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contents, generationConfig }),
  });
  let body = await res.json().catch(() => ({}));
  const errMsg = body?.error?.message || "";
  if (!res.ok && (/no longer available|not found|not supported/i.test(errMsg) || res.status === 404)) {
    for (const fb of ["gemini-3.6-flash", "gemini-2.5-flash", "gemini-2.0-flash-lite"]) {
      if (fb === model) continue;
      res = await fetch(urlFor(fb), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents, generationConfig }),
      });
      body = await res.json().catch(() => ({}));
      if (res.ok) {
        state.model = fb;
        localStorage.setItem(STORAGE.model, fb);
        break;
      }
    }
  }
  if (!res.ok) {
    const msg = body?.error?.message || res.statusText;
    if (res.status === 429) throw new Error("API limit (429). Thoda wait karke try karo.");
    if (res.status === 400 && /API key/i.test(msg)) throw new Error("Invalid API key.");
    throw new Error(msg || "Gemini failed");
  }
  return body;
}

// ---------- Files ----------
async function fileToModelPart(file) {
  const mime = file.type || guessMime(file.name);
  if (mime.startsWith("image/")) {
    return { inlineData: { mimeType: mime, data: await fileToBase64(file) } };
  }
  if ((mime === "application/pdf" || /\.pdf$/i.test(file.name)) && file.size < 15 * 1024 * 1024) {
    return { inlineData: { mimeType: "application/pdf", data: await fileToBase64(file) } };
  }
  return null;
}

async function extractLocalText(file) {
  const name = (file.name || "").toLowerCase();
  const mime = file.type || guessMime(file.name);
  if (mime.startsWith("text/") || name.endsWith(".txt") || name.endsWith(".csv")) return file.text();
  if (name.endsWith(".xlsx") || name.endsWith(".xls") || mime.includes("sheet")) {
    const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
    return wb.SheetNames.map((sn) => `[Sheet ${sn}]\n` + XLSX.utils.sheet_to_csv(wb.Sheets[sn])).join("\n");
  }
  if (mime === "application/pdf" || name.endsWith(".pdf")) return pdfToText(file);
  if (mime.startsWith("image/")) return "";
  try {
    return await file.text();
  } catch {
    return "";
  }
}

async function pdfToText(file) {
  if (!window.pdfjsLib) return "";
  const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
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
    .filter((t) => t && t.length > 1 && !STOP.has(t));
}
function brandToken(s) {
  const n = norm(s);
  for (const [k, v] of Object.entries(ALIAS_BRAND)) {
    if (n.includes(k)) return v;
  }
  const t = tokens(s);
  return t[0] || "";
}
function tokenScore(a, b) {
  const ta = new Set(tokens(a));
  const tb = new Set(tokens(b));
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  const cover = inter / ta.size;
  const jacc = inter / new Set([...ta, ...tb]).size;
  return cover * 0.7 + jacc * 0.3;
}
function packLooseEqual(a, b) {
  return a === b || a.includes(b) || b.includes(a);
}
function isTab(name, pack) {
  return /\b(tab|tabs|tablet|tablets|strip)\b/.test(norm(name + " " + pack));
}
function isSyrup(name, pack) {
  return /\b(syrup|syp|suspension)\b/.test(norm(name + " " + pack));
}
function isTabName(n) {
  return /\b(tab|tablet|strip)\b/.test(n);
}
function isSyrupName(n) {
  return /\b(syrup|syp)\b/.test(n);
}
function normalizeQty(q) {
  if (q == null || q === "") return "";
  if (typeof q === "number" && !Number.isNaN(q)) return q;
  const m = String(q).replace(/,/g, "").match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : String(q).trim();
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
  if (t.startsWith("```")) t = t.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
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
