/**
 * Mohan Order Creater v7
 * Modular: fuzzy match · confidence · dual-pane · dark/light · offline SW
 * Gemini = parse only · Codes = master/rules (local)
 */

/* =========================================================
   1. STORAGE & STATE
   ========================================================= */
const STORAGE = {
  apiKey: "moc_api_key",
  model: "moc_model",
  rules: "moc_rules_v1",
  master: "moc_master_v1",
  stats: "moc_stats_v1",
  theme: "moc_theme",
  autoLearn: "moc_auto_learn",
};

const DEPRECATED = {
  "gemini-2.0-flash": "gemini-3.6-flash",
  "gemini-1.5-flash": "gemini-3.6-flash",
  "gemini-1.5-flash-latest": "gemini-3.6-flash",
};

const SEED_ALIASES = [
  { pattern: "CHANDRIKA SOAP", pack: "75GM", code: "401283003", note: "CHK Soap 75g" },
  { pattern: "CHANDRIKA", pack: "", code: "401283003", note: "CHK Soap 75g" },
  { pattern: "ALASPAN TAB", pack: "10TAB", code: "401353005", note: "Alaspan Tablets-Strip Of 10" },
  { pattern: "ALASPAN TABS", pack: "", code: "401353005", note: "Alaspan Tablets-Strip Of 10" },
  { pattern: "BENADON", pack: "", code: "400016004", note: "BENADON TABLETS 15T" },
  { pattern: "CANESTEN S CREAM", pack: "15GM", code: "401376004", note: "Canesten S Cream 15G" },
  { pattern: "MYCOSPOR CREAM", pack: "30GM", code: "401379001", note: "Mycospor" },
  { pattern: "DIGEPLEX T TAB", pack: "", code: "401285008", note: "Digeplex-T Tablet 10S" },
  { pattern: "FERRADOL", pack: "200GM", code: "401220002", note: "Ferradol 200G" },
  { pattern: "SLOANS KILLS PAIN LINIMENT", pack: "71ML", code: "401210003", note: "Sloans Liniment 71ml" },
  { pattern: "SLOANS LINIMENT", pack: "71ML", code: "401210003", note: "Sloans Liniment 71ml" },
  { pattern: "SUPRADYN DAILY", pack: "60", code: "400134046", note: "Supradyn Daily 60s" },
  { pattern: "NEKO DAILY HYGIENE SOAP", pack: "100", code: "401179500", note: "Neko Daily Hygiene" },
  { pattern: "CALADRYL LOTION", pack: "65ML", code: "401114015", note: "Caladryl 65Ml" },
  { pattern: "CALADRYL LOTION", pack: "125ML", code: "401114016", note: "Caladryl 125Ml" },
  { pattern: "LACTO CALAMINE FACE LOTION ALOE", pack: "30ML", code: "400065156", note: "LC Face Lotion CTNS 30ml" },
  { pattern: "LC FACE LOTION OILY", pack: "30ML", code: "400065160", note: "LC Face Lotion Oily 30ml" },
];

const BRAND_ALIAS = {
  chandrika: "chk",
  chandirka: "chk",
  chk: "chk",
  sloan: "sloans",
  sloans: "sloans",
  "lacto calamine": "lc",
  lactocalamine: "lc",
  "lc face": "lc",
  alaspan: "alaspan",
  benadon: "benadon",
  canesten: "canesten",
  mycospor: "mycospor",
  digeplex: "digeplex",
  ferradol: "ferradol",
  supradyn: "supradyn",
  neko: "neko",
  littles: "littles",
  caladryl: "caladryl",
  tetmosol: "tetmosol",
  becozym: "becozym",
  becozyn: "becozym",
};

const STOP = new Set(
  "the and for of with tab tabs tablet tablets strip cream lotion syrup syp soap ml gm g mg bottle pack pcs of in on a an ta s t x".split(
    " "
  )
);

function loadJSON(key, fb) {
  try {
    const v = JSON.parse(localStorage.getItem(key) || "null");
    return v == null ? fb : v;
  } catch {
    return fb;
  }
}

function resolveModel(m) {
  const x = (m || "").trim() || "gemini-3.6-flash";
  return DEPRECATED[x] || x;
}

const state = {
  apiKey: localStorage.getItem(STORAGE.apiKey) || "",
  model: resolveModel(localStorage.getItem(STORAGE.model)),
  theme: localStorage.getItem(STORAGE.theme) || "dark",
  autoLearn: localStorage.getItem(STORAGE.autoLearn) !== "0",
  master: [],
  rules: loadJSON(STORAGE.rules, []),
  stats: loadJSON(STORAGE.stats, {
    orders_processed: 0,
    rules_learned: 0,
    cells_fixed: 0,
    last_green: 0,
    last_total: 0,
  }),
  brandIndex: new Map(),
  fuseIndex: [], // pre-normalized master rows for fuzzy
  files: [],
  rows: [],
  meta: { party: "", order_no: "", order_date: "", source: "" },
  busy: false,
  confirmResolver: null,
  pickResolver: null,
  apiCooldownUntil: 0, // timestamp ms — block Gemini calls after 429
};

/* =========================================================
   2. DOM REFS
   ========================================================= */
const $ = (id) => document.getElementById(id);

const els = {
  app: $("app"),
  fileInput: $("fileInput"),
  dropZone: $("dropZone"),
  previewEmpty: $("previewEmpty"),
  previewFrame: $("previewFrame"),
  sourceText: $("sourceText"),
  partyInput: $("partyInput"),
  btnProcess: $("btnProcess"),
  matchBody: $("matchBody"),
  resultsMeta: $("resultsMeta"),
  cGreen: $("cGreen"),
  cYellow: $("cYellow"),
  cRed: $("cRed"),
  btnFixAll: $("btnFixAll"),
  btnCopyExcel: $("btnCopyExcel"),
  btnNew: $("btnNew"),
  btnSettings: $("btnSettings"),
  btnTheme: $("btnTheme"),
  assistLog: $("assistLog"),
  assistInput: $("assistInput"),
  btnAssist: $("btnAssist"),
  settingsModal: $("settingsModal"),
  confirmModal: $("confirmModal"),
  confirmBody: $("confirmBody"),
  pickModal: $("pickModal"),
  pickList: $("pickList"),
  pickTitle: $("pickTitle"),
};

/* =========================================================
   3. TEXT NORMALIZE + FUZZY (Levenshtein + token)
   ========================================================= */
function normalize(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9%]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(s) {
  return normalize(s)
    .split(" ")
    .filter((t) => t && t.length > 1 && !STOP.has(t));
}

function brandOf(s) {
  const n = normalize(s);
  for (const [k, v] of Object.entries(BRAND_ALIAS)) {
    if (n.includes(k)) return v;
  }
  const t = tokens(s);
  return t[0] || "";
}

/** Levenshtein distance */
function levenshtein(a, b) {
  a = normalize(a);
  b = normalize(b);
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const m = a.length;
  const n = b.length;
  // banded for long strings
  if (m * n > 40000) {
    // fallback: rough
    return Math.abs(m - n) + 5;
  }
  let prev = new Array(n + 1);
  let cur = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= n; j++) {
      const cost = ca === b.charCodeAt(j - 1) ? 0 : 1;
      cur[j] = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[n];
}

/** Similarity 0–1 from Levenshtein */
function levSim(a, b) {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const d = levenshtein(na, nb);
  const maxLen = Math.max(na.length, nb.length) || 1;
  return Math.max(0, 1 - d / maxLen);
}

/** Token Jaccard + coverage (Fuse-like) */
function tokenScore(a, b) {
  const ta = new Set(tokens(a));
  const tb = new Set(tokens(b));
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  const cover = inter / ta.size;
  const jacc = inter / new Set([...ta, ...tb]).size;
  return cover * 0.65 + jacc * 0.35;
}

function packLoose(a, b) {
  const x = normalize(a).replace(/\s/g, "");
  const y = normalize(b).replace(/\s/g, "");
  if (!x || !y) return false;
  return x === y || x.includes(y) || y.includes(x);
}

function extractNums(s) {
  return (normalize(s).match(/\d+/g) || []).map(Number);
}

function isTab(name, pack) {
  return /\b(tab|tabs|tablet|tablets|strip)\b/.test(normalize(name + " " + pack));
}
function isSyrup(name, pack) {
  return /\b(syrup|syp|suspension)\b/.test(normalize(name + " " + pack));
}
function formOf(name, pack) {
  const n = normalize(name + " " + pack);
  if (/\b(tab|tablet|strip)\b/.test(n)) return "tab";
  if (/\b(syrup|syp)\b/.test(n)) return "syrup";
  if (/\b(cream|crea)\b/.test(n)) return "cream";
  if (/\blotion\b/.test(n)) return "lotion";
  if (/\bsoap\b/.test(n)) return "soap";
  if (/\bliniment\b/.test(n)) return "liniment";
  if (/\bpowder\b/.test(n)) return "powder";
  return "";
}

/**
 * Fuse-style weighted score 0–100 for product match
 * factors: token, levenshtein, brand, pack/size, form
 */
function scoreCandidate(poName, pack, masterName, masterCode) {
  const nPo = normalize(poName);
  const nPack = normalize(pack || "");
  const nM = normalize(masterName);
  let score = 0;

  const tok = tokenScore(nPo, nM); // 0–1
  const lev = levSim(nPo, nM); // 0–1
  score += tok * 45;
  score += lev * 25;

  const bPo = brandOf(poName);
  const bM = brandOf(masterName);
  if (bPo && bM && bPo === bM) score += 18;
  else if (bPo && nM.includes(bPo)) score += 10;

  // Chandrika ↔ CHK
  if (/chandrika/.test(nPo) && (nM.includes("chk") || nM.includes("chandrika"))) score += 20;
  if (/chandrika/.test(nPo) && nM.includes("soap")) score += 6;

  // pack numbers
  const nums = extractNums(nPo + " " + nPack);
  const mNums = extractNums(nM);
  if (nums.length && mNums.length) {
    const hit = nums.filter((x) => mNums.includes(x)).length;
    score += Math.min(12, hit * 6);
  }
  if (nPack && packLoose(nPack, nM)) score += 6;

  // form agreement
  const fPo = formOf(poName, pack);
  const fM = formOf(masterName, "");
  if (fPo && fM && fPo === fM) score += 10;
  if (fPo && fM && fPo !== fM) {
    if ((fPo === "tab" && fM === "syrup") || (fPo === "syrup" && fM === "tab")) score -= 28;
    else score -= 10;
  }

  // plain Alaspan TAB not AM
  if (/alaspan/.test(nPo) && isTab(poName, pack) && !/\bam\b|\bag\b|syrup|syp/.test(nPo)) {
    if (nM.includes("alaspan") && nM.includes("tablet") && !nM.includes(" am ") && !nM.includes("ag "))
      score += 16;
    if (nM.includes("alaspan am") || /\bam\b/.test(nM)) score -= 22;
    if (nM.includes("syrup")) score -= 25;
  }

  // code exact typed
  if (masterCode && normalize(poName) === normalize(masterCode)) score = 100;

  return Math.max(0, Math.min(100, Math.round(score)));
}

function confidenceTier(pct) {
  if (pct >= 78) return "green";
  if (pct >= 52) return "yellow";
  return "red";
}

/* =========================================================
   4. MASTER INDEX (async, non-blocking)
   ========================================================= */
function rebuildIndex() {
  state.brandIndex = new Map();
  state.fuseIndex = state.master.map((p, i) => {
    const nameN = normalize(p.name);
    const brand = brandOf(p.name);
    if (brand) {
      if (!state.brandIndex.has(brand)) state.brandIndex.set(brand, []);
      state.brandIndex.get(brand).push(i);
    }
    return {
      i,
      code: String(p.code),
      name: p.name,
      nameN,
      brand,
      tokens: tokens(p.name),
      min_qty: p.min_qty,
      case_qty: p.case_qty,
    };
  });
}

async function loadMasterAsync() {
  // yield to UI
  await tick();
  try {
    const cached = localStorage.getItem(STORAGE.master);
    if (cached) {
      state.master = JSON.parse(cached);
      if (state.master.length) {
        rebuildIndex();
        return;
      }
    }
  } catch (_) {}
  try {
    const res = await fetch("./master.json", { cache: "no-cache" });
    if (res.ok) {
      state.master = await res.json();
      localStorage.setItem(STORAGE.master, JSON.stringify(state.master));
      await tick();
      rebuildIndex();
    }
  } catch (e) {
    console.warn("master load failed", e);
  }
}

function tick() {
  return new Promise((r) => requestAnimationFrame(() => r()));
}

/** Rank master candidates — pool by brand when possible */
function rankMaster(poName, pack, limit = 8) {
  if (!state.fuseIndex.length) return [];
  const b = brandOf(poName);
  let poolIdx = null;
  if (b && state.brandIndex.has(b)) poolIdx = state.brandIndex.get(b);
  // alias brand redirect
  const nPo = normalize(poName);
  for (const [k, v] of Object.entries(BRAND_ALIAS)) {
    if (nPo.includes(k) && state.brandIndex.has(v)) {
      poolIdx = state.brandIndex.get(v);
      break;
    }
  }

  const scoreList = (indices) => {
    const out = [];
    for (const i of indices) {
      const row = state.fuseIndex[i];
      const sc = scoreCandidate(poName, pack, row.name, row.code);
      if (sc >= 28) out.push({ score: sc, p: state.master[i], idx: i });
    }
    return out;
  };

  let out = [];
  if (poolIdx && poolIdx.length) out = scoreList(poolIdx);
  out.sort((a, b) => b.score - a.score);

  if (!out.length || out[0].score < 48) {
    // full scan in chunks would be ideal; 317 is fine sync
    out = scoreList(state.fuseIndex.map((_, i) => i));
    out.sort((a, b) => b.score - a.score);
  }

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

/* =========================================================
   5. RULES + KNOWN ALIASES
   ========================================================= */
function saveRules() {
  localStorage.setItem(STORAGE.rules, JSON.stringify(state.rules));
  updateChrome();
}

function saveStats() {
  localStorage.setItem(STORAGE.stats, JSON.stringify(state.stats));
  updateChrome();
}

function upsertRule(rule, { silent = false } = {}) {
  if (!rule) return;
  const pattern = String(rule.pattern || rule.po_name || "").trim();
  const code = rule.code != null ? String(rule.code).trim() : "";
  if (!pattern || !code) return;
  const pack = String(rule.pack || "").trim();
  const party = String(rule.party || "").trim();
  const idx = state.rules.findIndex(
    (r) =>
      normalize(r.pattern) === normalize(pattern) &&
      normalize(r.pack || "") === normalize(pack) &&
      normalize(r.party || "") === normalize(party)
  );
  const row = {
    id: idx >= 0 ? state.rules[idx].id : "r_" + Date.now().toString(36),
    pattern,
    pack,
    party,
    code,
    qty_multiple: rule.qty_multiple != null ? Number(rule.qty_multiple) || null : null,
    note: rule.note || "",
    updated_at: new Date().toISOString(),
  };
  if (idx >= 0) state.rules[idx] = { ...state.rules[idx], ...row };
  else state.rules.push(row);
  saveRules();
  if (!silent) state.stats.rules_learned = (state.stats.rules_learned || 0) + 1;
  saveStats();
}

function seedAndPurge() {
  // purge bad Alaspan AM rule for plain TAB
  state.rules = state.rules.filter((r) => {
    if (/alaspan/i.test(r.pattern || "") && !/am/i.test(r.pattern || "") && String(r.code) === "401353008")
      return false;
    return true;
  });
  for (const s of SEED_ALIASES) {
    const exists = state.rules.some(
      (r) => normalize(r.pattern) === normalize(s.pattern) && normalize(r.pack || "") === normalize(s.pack || "")
    );
    if (!exists) {
      state.rules.push({
        id: "seed_" + normalize(s.pattern).replace(/\s/g, "_"),
        pattern: s.pattern,
        pack: s.pack || "",
        party: "",
        code: s.code,
        qty_multiple: null,
        note: s.note || "seed",
        updated_at: new Date().toISOString(),
      });
    }
  }
  saveRules();
}

function matchRule(poName, pack) {
  const nPo = normalize(poName);
  const nPack = normalize(pack || "");
  let best = null;
  let bestSc = 0;
  for (const r of state.rules) {
    const rp = normalize(r.pattern);
    if (!rp) continue;
    let sc = 0;
    if (nPo === rp) sc = 100;
    else if (nPo.includes(rp) || rp.includes(nPo)) sc = 88;
    else sc = Math.round(tokenScore(nPo, rp) * 80 + levSim(nPo, rp) * 20);
    if (r.pack) {
      const rpk = normalize(r.pack);
      if (nPack && (nPack.includes(rpk) || rpk.includes(nPack) || packLoose(nPack, rpk))) sc += 8;
      else if (nPack && sc < 95) sc -= 15;
    }
    if (sc > bestSc) {
      bestSc = sc;
      best = r;
    }
  }
  if (best && bestSc >= 78 && best.code) return { rule: best, score: Math.min(100, bestSc) };
  return null;
}

/** Deterministic hard locks */
function knownAlias(poName, pack) {
  const n = normalize(poName);
  const p = normalize(pack || "");
  const both = n + " " + p;
  if (/chandrika/.test(n)) return { code: "401283003", name: "CHK Soap 75g", conf: 100 };
  if (/alaspan/.test(n) && /tab/.test(both) && !/\bam\b|\bag\b|syrup|syp/.test(n))
    return { code: "401353005", name: "Alaspan Tablets-Strip Of 10 Ta", conf: 100 };
  if (/benadon/.test(n)) return { code: "400016004", name: "BENADON TABLETS 15T", conf: 100 };
  if (/canesten\s*s/.test(n) && /15/.test(both))
    return { code: "401376004", name: "Canesten S Cream 15G In", conf: 98 };
  if (/mycospor/.test(n)) return { code: "401379001", name: "Mycospor 1% Crea 1X30 G In", conf: 96 };
  if (/digeplex\s*t/.test(n) && /tab/.test(both))
    return { code: "401285008", name: "Digeplex-T Tablet 10S", conf: 96 };
  if (/^ferradol/.test(n.trim()) && /200/.test(both))
    return { code: "401220002", name: "Ferradol 200G", conf: 96 };
  if (/sloan/.test(n) && /liniment|71/.test(both))
    return { code: "401210003", name: "Sloans Pain Relief Liniment 71ml", conf: 96 };
  if (/supradyn/.test(n) && /daily/.test(n) && /60/.test(both))
    return { code: "400134046", name: "SUPRADYN DAILY TABLETS 60'S BOTTLE", conf: 96 };
  if (/lacto\s*calamine|lc face lotion/.test(n) && /aloe|ctns|normal/.test(both + n) && /30/.test(both))
    return { code: "400065156", name: "LC Face Lotion CTNS 30ml", conf: 90 };
  if (/lacto\s*calamine|lc face lotion/.test(n) && /oily/.test(n) && /30/.test(both))
    return { code: "400065160", name: "LC Face Lotion Oily 30ml", conf: 90 };
  // seed table
  for (const s of SEED_ALIASES) {
    const sp = normalize(s.pattern);
    if (!(n === sp || n.includes(sp) || sp.includes(n) || tokenScore(n, sp) > 0.88)) continue;
    if (s.pack) {
      const pk = normalize(s.pack);
      if (p && !(p.includes(pk) || pk.includes(p) || packLoose(p, pk))) {
        if (!(n === sp || n.startsWith(sp))) continue;
      }
    }
    return { code: s.code, name: s.note || "seed", conf: 99 };
  }
  return null;
}

/**
 * Full match pipeline → { code, status, conf, master_name, candidates, note }
 * conf = 0–100 for material code match
 */
function matchProduct(poName, pack, party) {
  const candidates = [];

  // 1 known
  const known = knownAlias(poName, pack);
  if (known) {
    return {
      code: known.code,
      status: "green",
      conf: known.conf,
      conf_qty: 100,
      conf_price: null,
      master_name: known.name,
      note: "known alias",
      candidates: [],
    };
  }

  // 2 rules
  const ruled = matchRule(poName, pack);
  if (ruled) {
    return {
      code: ruled.rule.code,
      status: "green",
      conf: ruled.score,
      conf_qty: 100,
      conf_price: null,
      master_name: ruled.rule.note || "rule",
      note: "learned rule",
      candidates: [],
    };
  }

  // 3 fuzzy master
  const ranked = rankMaster(poName, pack, 8);
  for (const c of ranked) {
    candidates.push({
      code: String(c.p.code),
      name: c.p.name,
      conf: c.score,
      min_qty: c.p.min_qty,
      case_qty: c.p.case_qty,
    });
  }

  if (!candidates.length) {
    return {
      code: "",
      status: "red",
      conf: 0,
      conf_qty: qtyConfidence(null, null),
      conf_price: null,
      master_name: "",
      note: "no match",
      candidates: [],
    };
  }

  const top = candidates[0];
  const second = candidates[1];
  const gap = second ? top.conf - second.conf : 100;
  let status = confidenceTier(top.conf);
  if (status === "green" && gap < 6 && second && second.conf >= 70) status = "yellow";

  // unique brand in master
  const b = brandOf(poName);
  if (b && status !== "green") {
    const same = state.master.filter((p) => brandOf(p.name) === b);
    if (same.length === 1 && brandOf(top.name) === b && top.conf >= 45) {
      status = "green";
      top.conf = Math.max(top.conf, 85);
    }
  }

  return {
    code: status === "red" ? "" : top.code,
    status,
    conf: top.conf,
    conf_qty: 100,
    conf_price: null,
    master_name:
      status === "yellow"
        ? candidates
            .slice(0, 3)
            .map((c) => c.name)
            .join(" | ")
        : top.name,
    note: status === "yellow" ? (gap < 6 ? "ambiguous" : "review") : "",
    candidates,
  };
}

function qtyConfidence(qty, masterRow) {
  if (qty == null || qty === "") return 0;
  if (!masterProp) return 90;
  // optional: check min / case multiples later
  return 95;
}

function priceConfidence() {
  return null; // PO unit price matching optional — not in current master
}

/* =========================================================
   6. FILE / PREVIEW
   ========================================================= */
function setupPdfJs() {
  if (window.pdfjsLib) {
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js";
  }
}

function renderPreview() {
  const empty = els.previewEmpty;
  const frame = els.previewFrame;
  if (!state.files.length) {
    empty.classList.remove("hidden");
    frame.classList.add("hidden");
    frame.innerHTML = "";
    return;
  }
  empty.classList.add("hidden");
  frame.classList.remove("hidden");

  const f = state.files[0];
  const url = URL.createObjectURL(f);
  const mime = f.type || guessMime(f.name);

  if (mime === "application/pdf" || /\.pdf$/i.test(f.name)) {
    frame.innerHTML = `<iframe title="PDF preview" src="${url}#view=FitH"></iframe>`;
  } else if (mime.startsWith("image/")) {
    frame.innerHTML = `<img alt="PO image" src="${url}" />`;
  } else {
    frame.innerHTML =
      `<div class="file-chip-list">` +
      state.files
        .map(
          (file, i) =>
            `<div class="file-chip">📎 ${escapeHtml(file.name)} <button type="button" data-i="${i}" aria-label="remove">✕</button></div>`
        )
        .join("") +
      `</div>`;
    frame.querySelectorAll("button[data-i]").forEach((btn) => {
      btn.onclick = () => {
        state.files.splice(+btn.dataset.i, 1);
        renderPreview();
      };
    });
  }
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

async function extractLocalText(file) {
  const name = (file.name || "").toLowerCase();
  const mime = file.type || guessMime(file.name);
  if (mime.startsWith("text/") || name.endsWith(".txt") || name.endsWith(".csv")) return file.text();
  if (name.endsWith(".xlsx") || name.endsWith(".xls") || (mime && mime.includes("sheet"))) {
    if (!window.XLSX) return "";
    const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
    return wb.SheetNames.map((sn) => `[Sheet ${sn}]\n` + XLSX.utils.sheet_to_csv(wb.Sheets[sn])).join(
      "\n"
    );
  }
  if (mime === "application/pdf" || name.endsWith(".pdf")) return pdfToText(file);
  return "";
}

async function pdfToText(file) {
  if (!window.pdfjsLib) return "";
  try {
    const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
    let text = "";
    const max = Math.min(pdf.numPages, 20);
    for (let i = 1; i <= max; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      text += content.items.map((it) => it.str).join(" ") + "\n";
    }
    return text;
  } catch {
    return "";
  }
}

async function fileToInlinePart(file) {
  const mime = file.type || guessMime(file.name);
  if (mime.startsWith("image/")) {
    return { inlineData: { mimeType: mime, data: await toBase64(file) } };
  }
  if ((mime === "application/pdf" || /\.pdf$/i.test(file.name)) && file.size < 15 * 1024 * 1024) {
    return { inlineData: { mimeType: "application/pdf", data: await toBase64(file) } };
  }
  return null;
}

function toBase64(file) {
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

/* =========================================================
   7. GEMINI PARSE (only)
   ========================================================= */
async function geminiRequest(body) {
  // Respect cooldown after rate-limit (don't spam free tier)
  const now = Date.now();
  if (state.apiCooldownUntil && now < state.apiCooldownUntil) {
    const sec = Math.ceil((state.apiCooldownUntil - now) / 1000);
    const err = new Error(
      `API limit (429). Free tier RPM/RPD full. Wait ~${sec}s then try once. Ya neeche text paste karke Generate dabao.`
    );
    err.code = 429;
    throw err;
  }

  let model = resolveModel(state.model);
  state.model = model;
  const url = (m) =>
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      m
    )}:generateContent?key=${encodeURIComponent(state.apiKey)}`;

  let res = await fetch(url(model), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  let data = await res.json().catch(() => ({}));
  const errMsg = data?.error?.message || "";

  // Only swap model on 404 / retired — NEVER on 429 (that multiplies quota burn)
  if (!res.ok && res.status !== 429 && (/no longer available|not found|not supported/i.test(errMsg) || res.status === 404)) {
    for (const fb of ["gemini-3.6-flash", "gemini-2.5-flash", "gemini-2.0-flash-lite"]) {
      if (fb === model) continue;
      res = await fetch(url(fb), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      data = await res.json().catch(() => ({}));
      if (res.status === 429) break; // stop fallback chain on rate limit
      if (res.ok) {
        state.model = fb;
        localStorage.setItem(STORAGE.model, fb);
        break;
      }
    }
  }

  if (!res.ok) {
    const msg = data?.error?.message || res.statusText;
    if (res.status === 429) {
      // 60s cooldown — free tier per-minute limit
      state.apiCooldownUntil = Date.now() + 60_000;
      const err = new Error(
        "API limit (429). Free Gemini quota full (RPM/RPD). 60s wait — baar-baar mat dabao. Photo/PDF ke liye baad me 1 baar try, ya text paste karo."
      );
      err.code = 429;
      throw err;
    }
    if (/API key/i.test(msg)) throw new Error("Invalid API key — check Settings.");
    throw new Error(msg || "Gemini request failed");
  }
  // success clears cooldown
  state.apiCooldownUntil = 0;
  return data;
}

async function parseOrderWithGemini({ userText, localText, parts }) {
  // brand-relevant master excerpt
  const blob = normalize((userText || "") + " " + (localText || ""));
  const brands = new Set();
  for (const p of state.master) {
    const b = brandOf(p.name);
    if (b && blob.includes(b)) brands.add(b);
  }
  for (const k of Object.keys(BRAND_ALIAS)) {
    if (blob.includes(k)) brands.add(BRAND_ALIAS[k]);
  }
  let hint = [];
  for (const b of brands) {
    const idxs = state.brandIndex.get(b) || [];
    for (const i of idxs.slice(0, 10)) {
      const p = state.master[i];
      hint.push(`${p.code}|${p.name}`);
    }
  }
  if (hint.length < 20) {
    hint = hint.concat(state.master.slice(0, 40).map((p) => `${p.code}|${p.name}`));
  }
  hint = [...new Set(hint)].slice(0, 100).join("\n");

  const sys = `Extract purchase-order line items from messy distributor POs (PDF/text/image).
Return ONLY JSON:
{
  "party": "",
  "order_no": "",
  "order_date": "",
  "items": [
    { "po_name": "exact product text from PO", "pack": "size/pack", "qty": number, "unit_price": number|null }
  ]
}
Rules:
- Keep distributor wording in po_name.
- qty = ordered quantity (number).
- unit_price if visible else null.
- Do NOT invent material codes.
- Skip headers, totals, addresses.`;

  const userParts = [
    {
      text:
        sys +
        "\n\nUser/party note:\n" +
        (userText || "") +
        "\n\nExtracted text:\n" +
        truncate(localText || "", 100000) +
        "\n\nMaster excerpt (context only, do not output codes):\n" +
        hint,
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
    // local fallback parse
    const fb = localFallbackParse(localText || userText || "");
    if (fb.items.length) return fb;
    throw new Error("Could not parse PO. Try clearer PDF or paste text.");
  }
  return json;
}

/** Simple local line parser when Gemini unavailable */
function localFallbackParse(text) {
  const lines = String(text)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const items = [];
  for (const line of lines) {
    // e.g. ALASPAN TAB 10TAB 40
    const m = line.match(/^(.+?)\s+(\d+(?:\.\d+)?)\s*(tab|tabs|ml|gm|g|mg|s)?\s+(\d+)\s*$/i);
    if (m) {
      items.push({
        po_name: m[1].trim(),
        pack: (m[2] + (m[3] || "")).trim(),
        qty: Number(m[4]),
        unit_price: null,
      });
      continue;
    }
    const m2 = line.match(/^(\d+)[\).\s]+(.+?)\s+(\d+)\s*$/);
    if (m2) {
      items.push({ po_name: m2[2].trim(), pack: "", qty: Number(m2[3]), unit_price: null });
    }
  }
  return { party: "", order_no: "", order_date: "", items };
}

/* =========================================================
   8. PROCESS PIPELINE
   ========================================================= */
async function processOrder() {
  if (state.busy) return;
  const text = els.sourceText.value.trim();
  const partyHint = els.partyInput.value.trim();
  if (!state.files.length && !text) {
    assist("bot", "Upload a PO file or paste text first.");
    return;
  }
  if (!state.apiKey && !text && state.files.length) {
    // try local extract only
  }

  state.busy = true;
  els.btnProcess.classList.add("loading");
  els.btnProcess.disabled = true;
  assist("bot", "Processing… parsing PO & fuzzy-matching master…");

  try {
    let localText = text;
    const parts = [];
    for (const f of state.files) {
      try {
        const t = await extractLocalText(f);
        if (t) localText += "\n\n--- " + f.name + " ---\n" + t;
      } catch (_) {}
      if (state.apiKey) {
        const p = await fileToInlinePart(f);
        if (p) parts.push(p);
      }
      await tick();
    }

    let parsed;
    if (state.apiKey) {
      try {
        parsed = await parseOrderWithGemini({
          userText: [partyHint, text].filter(Boolean).join("\n"),
          localText,
          parts,
        });
      } catch (apiErr) {
        // On 429 / API fail: try local text extract so user is not stuck
        const fb = localFallbackParse(localText || text || "");
        if (fb.items.length) {
          parsed = fb;
          assist(
            "bot",
            `⚠ Gemini limit/error — local text se ${fb.items.length} lines parse kiye (photo-only PO me kam accurate). ` +
              (apiErr.code === 429 ? "1 minute baad AI parse dubara try karo." : escapeHtml(apiErr.message || ""))
          );
        } else {
          throw apiErr;
        }
      }
    } else {
      parsed = localFallbackParse(localText);
      if (!parsed.items.length) {
        throw new Error("No API key and local parse found no lines. Add Gemini key in Settings.");
      }
      assist("bot", "⚠ No API key — used local text parse (limited).");
    }

    if (partyHint) parsed.party = partyHint || parsed.party;

    // Match each line (local fuzzy — never invent codes)
    const rows = [];
    for (const it of parsed.items || []) {
      const poName = String(it.po_name || it.name || "").trim();
      const pack = String(it.pack || "").trim();
      const qty = normQty(it.qty);
      const unit_price = it.unit_price != null && it.unit_price !== "" ? Number(it.unit_price) : null;
      const m = matchProduct(poName, pack, parsed.party || "");
      rows.push({
        po_name: poName,
        pack,
        qty,
        unit_price,
        code: m.code || "",
        status: m.status,
        conf: m.conf || 0,
        conf_qty: m.conf_qty ?? 90,
        conf_price: unit_price != null ? 80 : null,
        master_name: m.master_name || "",
        note: m.note || "",
        candidates: m.candidates || [],
        party: parsed.party || "",
      });
      await tick();
    }

    // Auto-learn strong greens
    let learned = 0;
    if (state.autoLearn) {
      for (const r of rows) {
        if (r.status === "green" && r.conf >= 88 && r.code && r.po_name) {
          if (/alaspan/i.test(r.po_name) && r.code === "401353008") continue;
          const exists = state.rules.some(
            (x) => normalize(x.pattern) === normalize(r.po_name) && normalize(x.pack || "") === normalize(r.pack || "")
          );
          if (!exists) {
            upsertRule(
              { pattern: r.po_name, pack: r.pack, code: r.code, note: "auto high-conf" },
              { silent: true }
            );
            learned++;
          }
        }
      }
      if (learned) {
        state.stats.rules_learned = (state.stats.rules_learned || 0) + learned;
        saveStats();
      }
    }

    state.rows = rows;
    state.meta = {
      party: parsed.party || partyHint || "",
      order_no: parsed.order_no || "",
      order_date: parsed.order_date || "",
      source: state.files.map((f) => f.name).join(", ") || "text",
    };

    const g = rows.filter((r) => r.status === "green").length;
    state.stats.orders_processed = (state.stats.orders_processed || 0) + 1;
    state.stats.last_green = g;
    state.stats.last_total = rows.length;
    saveStats();

    renderTable();
    assist(
      "bot",
      `Matched <b>${rows.length}</b> lines · 🟢 ${g} · 🟡 ${rows.filter((r) => r.status === "yellow").length} · 🔴 ${rows.filter((r) => r.status === "red").length}` +
        (learned ? ` · auto-learned ${learned} rules` : "") +
        `\nFuzzy confidence on each row. Yellow = pick / edit. Use Fix All or assist chat.`
    );
  } catch (err) {
    console.error(err);
    assist("bot", "Error: " + (err.message || String(err)));
  } finally {
    state.busy = false;
    els.btnProcess.classList.remove("loading");
    els.btnProcess.disabled = false;
  }
}

function normQty(q) {
  if (q == null || q === "") return "";
  if (typeof q === "number" && !Number.isNaN(q)) return q;
  const m = String(q).replace(/,/g, "").match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : String(q).trim();
}

/* =========================================================
   9. TABLE UI + VALIDATION
   ========================================================= */
function renderTable() {
  const tb = els.matchBody;
  if (!state.rows.length) {
    tb.innerHTML = `<tr class="empty-row"><td colspan="7">Upload a PO and press <b>Generate Match</b></td></tr>`;
    els.btnFixAll.disabled = true;
    els.btnCopyExcel.disabled = true;
    updateCounts();
    els.resultsMeta.textContent = "No order yet";
    return;
  }

  els.btnFixAll.disabled = false;
  els.btnCopyExcel.disabled = false;
  const meta = state.meta;
  els.resultsMeta.textContent = [
    meta.party || "Order",
    meta.order_no && `#${meta.order_no}`,
    meta.order_date,
    meta.source,
  ]
    .filter(Boolean)
    .join(" · ");

  tb.innerHTML = "";
  state.rows.forEach((row, idx) => {
    const tr = document.createElement("tr");
    tr.dataset.idx = idx;
    const confClass = row.conf >= 78 ? "hi" : row.conf >= 52 ? "mid" : "lo";
    const codeInvalid = row.status !== "green" || !row.code;
    tr.innerHTML = `
      <td class="col-st"><span class="st-bar ${row.status}"></span></td>
      <td>
        <input class="cell-input code ${codeInvalid ? "invalid" : ""}" data-k="code" value="${escapeAttr(
          row.code || ""
        )}" inputmode="numeric" />
      </td>
      <td>
        <input class="cell-input qty" data-k="qty" value="${escapeAttr(row.qty ?? "")}" inputmode="decimal" />
      </td>
      <td>
        <input class="cell-input" data-k="po_name" value="${escapeAttr(row.po_name || "")}" />
        ${
          row.master_name || row.note
            ? `<span class="master-hint">${escapeHtml(
                [row.master_name && `→ ${row.master_name}`, row.note].filter(Boolean).join(" · ")
              )}</span>`
            : ""
        }
      </td>
      <td><input class="cell-input" data-k="pack" value="${escapeAttr(row.pack || "")}" style="max-width:88px" /></td>
      <td><span class="conf-pill ${confClass}" title="Material code confidence">${row.conf ?? 0}%</span></td>
      <td><button type="button" class="btn-pick" data-pick="${idx}">Options</button></td>
    `;

    tr.querySelectorAll(".cell-input").forEach((inp) => {
      inp.addEventListener("change", () => onCellChange(idx, inp.dataset.k, inp.value));
      inp.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          inp.blur();
        }
      });
    });
    tr.querySelector(".btn-pick").onclick = () => openPicker(idx);

    tb.appendChild(tr);
  });
  updateCounts();
}

function updateCounts() {
  const g = state.rows.filter((r) => r.status === "green").length;
  const y = state.rows.filter((r) => r.status === "yellow").length;
  const r = state.rows.filter((r) => r.status === "red").length;
  els.cGreen.textContent = g;
  els.cYellow.textContent = y;
  els.cRed.textContent = r;
  $("statMatch").textContent = state.rows.length ? `${g}/${state.rows.length}` : "—";
}

async function onCellChange(idx, key, value) {
  const row = state.rows[idx];
  if (!row) return;
  if (key === "code") {
    const code = String(value || "").trim();
    const old = row.code;
    row.code = code;
    if (code) {
      row.status = "green";
      row.conf = 100;
      row.note = "manual";
      const m = state.master.find((p) => String(p.code) === code);
      if (m) row.master_name = m.name;
      const ok = await askConfirm(`Save rule?\n\n"${row.po_name}" ${row.pack || ""}\n→ ${code}`);
      if (ok) {
        upsertRule({ pattern: row.po_name, pack: row.pack, code, note: "manual cell" });
        state.stats.cells_fixed = (state.stats.cells_fixed || 0) + 1;
        saveStats();
        assist("bot", `Rule saved: ${row.po_name} → ${code}`);
      } else if (!old) {
        /* keep code without rule */
      }
    } else {
      row.status = "red";
      row.conf = 0;
    }
  } else if (key === "qty") {
    row.qty = normQty(value);
  } else if (key === "po_name") {
    row.po_name = String(value || "").trim();
    const m = matchProduct(row.po_name, row.pack, row.party);
    Object.assign(row, {
      code: m.code || row.code,
      status: m.status,
      conf: m.conf,
      master_name: m.master_name,
      note: m.note,
      candidates: m.candidates,
    });
  } else if (key === "pack") {
    row.pack = String(value || "").trim();
    const m = matchProduct(row.po_name, row.pack, row.party);
    Object.assign(row, {
      code: m.code || row.code,
      status: m.status,
      conf: m.conf,
      master_name: m.master_name,
      note: m.note,
      candidates: m.candidates,
    });
  }
  renderTable();
}

function fixAll() {
  for (const row of state.rows) {
    const m = matchProduct(row.po_name, row.pack, row.party);
    if (m.code) {
      row.code = m.code;
      row.status = m.status === "red" ? "yellow" : m.status;
      row.conf = m.conf;
      row.master_name = m.master_name;
      row.note = m.note || "fix all";
      row.candidates = m.candidates;
      if (row.status === "green" && state.autoLearn) {
        upsertRule(
          { pattern: row.po_name, pack: row.pack, code: row.code, note: "fix all" },
          { silent: true }
        );
      }
    }
  }
  const g = state.rows.filter((r) => r.status === "green").length;
  state.stats.last_green = g;
  state.stats.last_total = state.rows.length;
  saveStats();
  renderTable();
  assist("bot", `Fix All complete · 🟢 ${g}/${state.rows.length}`);
}

async function openPicker(idx) {
  const row = state.rows[idx];
  if (!row) return;
  let cands = row.candidates?.length ? row.candidates : rankMaster(row.po_name, row.pack, 8).map((c) => ({
    code: String(c.p.code),
    name: c.p.name,
    conf: c.score,
  }));
  if (!cands.length) {
    assist("bot", "No candidates in master for this name.");
    return;
  }
  els.pickTitle.textContent = `Match: ${row.po_name}`;
  els.pickList.innerHTML = cands
    .map(
      (c, i) =>
        `<button type="button" class="pick-item" data-i="${i}"><b>${escapeHtml(c.code)}</b> ${escapeHtml(
          c.name
        )} <small>${c.conf ?? ""}%</small></button>`
    )
    .join("");
  els.pickModal.classList.remove("hidden");

  const choice = await new Promise((resolve) => {
    state.pickResolver = resolve;
    els.pickList.querySelectorAll(".pick-item").forEach((btn) => {
      btn.onclick = () => {
        els.pickModal.classList.add("hidden");
        resolve(cands[+btn.dataset.i]);
      };
    });
    $("btnClosePick").onclick = () => {
      els.pickModal.classList.add("hidden");
      resolve(null);
    };
  });
  state.pickResolver = null;
  if (!choice) return;
  row.code = choice.code;
  row.status = "green";
  row.conf = choice.conf ?? 100;
  row.master_name = choice.name;
  row.note = "picked";
  upsertRule({ pattern: row.po_name, pack: row.pack, code: choice.code, note: "picker" }, { silent: true });
  state.stats.cells_fixed = (state.stats.cells_fixed || 0) + 1;
  state.stats.rules_learned = (state.stats.rules_learned || 0) + 1;
  saveStats();
  renderTable();
  assist("bot", `Picked ${choice.code} — ${choice.name}`);
}

async function copyExcel() {
  const header = "Code\tQty\tPO Name\tPack\tConfidence%\tStatus";
  const body = state.rows
    .map(
      (r) =>
        `${r.code || ""}\t${r.qty ?? ""}\t${r.po_name || ""}\t${r.pack || ""}\t${r.conf ?? ""}\t${r.status}`
    )
    .join("\n");
  const text = header + "\n" + body;
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
  assist("bot", "Copied for Excel (TSV). Ctrl+V in sheet.");
}

/* =========================================================
   10. ASSIST CHAT (local-first)
   ========================================================= */
function assist(who, html) {
  const div = document.createElement("div");
  div.className = "assist-msg " + who;
  div.innerHTML = html;
  els.assistLog.appendChild(div);
  els.assistLog.scrollTop = els.assistLog.scrollHeight;
}

function handleAssist() {
  const text = els.assistInput.value.trim();
  if (!text) return;
  els.assistInput.value = "";
  assist("user", escapeHtml(text));

  if (!state.rows.length) {
    assist("bot", "Pehle Generate Match chalao.");
    return;
  }

  // code assign: Name 401283003
  const mCode = text.match(/^(.+?)\s+(\d{6,12})\s*$/);
  if (mCode) {
    const name = mCode[1].trim();
    const code = mCode[2];
    let idx = state.rows.findIndex(
      (r) => normalize(r.po_name).includes(normalize(name)) || normalize(name).includes(brandOf(r.po_name))
    );
    if (idx < 0) idx = state.rows.findIndex((r) => brandOf(r.po_name) === brandOf(name));
    // chandrika special
    if (idx < 0 && /chandrika|chk/i.test(name)) {
      idx = state.rows.findIndex((r) => /chandrika|chk|soap/i.test(r.po_name));
    }
    if (idx >= 0) {
      const row = state.rows[idx];
      row.code = code;
      row.status = "green";
      row.conf = 100;
      const m = state.master.find((p) => String(p.code) === code);
      if (m) row.master_name = m.name;
      upsertRule({ pattern: row.po_name, pack: row.pack, code, note: "assist" });
      state.stats.cells_fixed++;
      saveStats();
      renderTable();
      assist("bot", `✅ ${row.po_name} → <b>${code}</b>`);
      return;
    }
  }

  // rematch / fix / master check / product name
  if (
    /(fix|rematch|master|check|dhoond|dhund|search|dekh|map|match|chandrika|benadon|alaspan|soap)/i.test(
      text
    ) ||
    text.split(/\s+/).length <= 5
  ) {
    // focus resolve
    const focus = text
      .replace(
        /(master|file|me|check|kar|karke|dhoond|dhund|search|dekh|fix|all|rematch|map|ai|ki|madat|se|please|pls)/gi,
        " "
      )
      .replace(/\s+/g, " ")
      .trim();

    let updated = 0;
    for (const row of state.rows) {
      const n = normalize(row.po_name);
      const f = normalize(focus);
      const hit =
        !f ||
        n.includes(f) ||
        f.includes(brandOf(row.po_name)) ||
        brandOf(row.po_name) === brandOf(focus) ||
        (/chandrika|chk/.test(f) && /chandrika|soap/.test(n));
      if (!hit && row.status === "green") continue;
      if (!hit && f) continue;
      const m = matchProduct(row.po_name, row.pack, row.party);
      if (m.code) {
        row.code = m.code;
        row.status = m.status;
        row.conf = m.conf;
        row.master_name = m.master_name;
        row.note = m.note || "assist";
        row.candidates = m.candidates;
        if (row.status === "green") {
          upsertRule(
            { pattern: row.po_name, pack: row.pack, code: row.code, note: "assist match" },
            { silent: true }
          );
          updated++;
        }
      }
    }
    const g = state.rows.filter((r) => r.status === "green").length;
    state.stats.last_green = g;
    state.stats.last_total = state.rows.length;
    saveStats();
    renderTable();

    if (/chandrika|chk/i.test(text)) {
      const ch = state.rows.find((r) => /chandrika/i.test(r.po_name));
      if (ch)
        assist(
          "bot",
          `✅ Chandrika → <b>${ch.code || "?"}</b> (${escapeHtml(ch.master_name || "CHK")}) · conf ${ch.conf}%`
        );
    }
    assist("bot", `Local fuzzy resolve · updated ~${updated} · 🟢 ${g}/${state.rows.length}`);
    return;
  }

  assist("bot", "Try: <b>Fix All</b>, product name, or <b>Name 401283003</b>");
}

/* =========================================================
   11. SETTINGS / THEME / CHROME
   ========================================================= */
function applyTheme(theme) {
  state.theme = theme === "light" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", state.theme);
  localStorage.setItem(STORAGE.theme, state.theme);
  els.btnTheme.textContent = state.theme === "dark" ? "◐" : "◑";
}

function learningPct() {
  const rules = state.rules.length;
  const orders = state.stats.orders_processed || 0;
  return Math.min(
    100,
    Math.round(rules * 0.4 + Math.min(orders, 80) * 0.4 + Math.min(state.stats.cells_fixed || 0, 40) * 0.25)
  );
}

function updateChrome() {
  $("statMaster").textContent = String(state.master.length);
  $("statRules").textContent = String(state.rules.length);
  const pct = learningPct();
  $("learnPct").textContent = pct + "%";
  $("learnBar").style.width = pct + "%";
  $("learnDetail").textContent = `Orders ${state.stats.orders_processed || 0} · Fixes ${
    state.stats.cells_fixed || 0
  }`;
  $("masterStatus").textContent = `${state.master.length} products loaded`;
  $("rulesStatus").textContent = `${state.rules.length} rules · learning ${pct}%`;
  if (state.rows.length) {
    $("statMatch").textContent = `${state.rows.filter((r) => r.status === "green").length}/${
      state.rows.length
    }`;
  }
}

function openSettings() {
  $("apiKeyInput").value = state.apiKey;
  $("modelSelect").value = state.model;
  $("chkAutoLearn").checked = state.autoLearn;
  updateChrome();
  els.settingsModal.classList.remove("hidden");
}
function closeSettings() {
  els.settingsModal.classList.add("hidden");
}
function saveSettings() {
  state.apiKey = $("apiKeyInput").value.trim();
  state.model = resolveModel($("modelSelect").value);
  state.autoLearn = $("chkAutoLearn").checked;
  localStorage.setItem(STORAGE.apiKey, state.apiKey);
  localStorage.setItem(STORAGE.model, state.model);
  localStorage.setItem(STORAGE.autoLearn, state.autoLearn ? "1" : "0");
  closeSettings();
  assist("bot", state.apiKey ? "Settings saved. Model: " + state.model : "API key cleared.");
}

function askConfirm(text) {
  $("confirmBody").textContent = text;
  els.confirmModal.classList.remove("hidden");
  return new Promise((resolve) => {
    state.confirmResolver = resolve;
  });
}
function finishConfirm(yes) {
  els.confirmModal.classList.add("hidden");
  const r = state.confirmResolver;
  state.confirmResolver = null;
  if (r) r(yes);
}

async function onMasterUpload(e) {
  const f = e.target.files?.[0];
  if (!f) return;
  try {
    const products = await parseMasterFile(f);
    if (!products.length) throw new Error("No products found");
    state.master = products;
    localStorage.setItem(STORAGE.master, JSON.stringify(products));
    rebuildIndex();
    updateChrome();
    assist("bot", `Master updated: ${products.length} products`);
  } catch (err) {
    alert("Master upload failed: " + err.message);
  }
  e.target.value = "";
}

async function parseMasterFile(file) {
  await tick();
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
  if (!rows.length) return [];
  const header = rows[0].map((h) => String(h).toLowerCase().trim());
  let codeIdx = header.findIndex((h) => /material|code|sku/.test(h));
  let nameIdx = header.findIndex((h) => /description|product|name/.test(h));
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
      min_qty: minIdx >= 0 && r[minIdx] !== "" ? Number(r[minIdx]) : null,
      case_qty: caseIdx >= 0 && r[caseIdx] !== "" ? Number(r[caseIdx]) : null,
    });
  }
  return out;
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
    if (!Array.isArray(rules)) throw new Error("Invalid");
    state.rules = rules;
    if (data.stats) state.stats = { ...state.stats, ...data.stats };
    saveRules();
    saveStats();
    assist("bot", `Imported ${rules.length} rules`);
  } catch (err) {
    alert("Import failed: " + err.message);
  }
  e.target.value = "";
}

function clearRules() {
  if (!confirm("Clear ALL learned rules? Seeds will reload.")) return;
  state.rules = [];
  seedAndPurge();
  assist("bot", "Rules cleared + seeds restored");
}

function newOrder() {
  state.files = [];
  state.rows = [];
  state.meta = { party: "", order_no: "", order_date: "", source: "" };
  els.sourceText.value = "";
  els.partyInput.value = "";
  renderPreview();
  renderTable();
  els.assistLog.innerHTML = "";
  assist("bot", "New order. Upload PO or paste text → Generate Match.");
}

/* =========================================================
   12. UTILS
   ========================================================= */
function truncate(s, n) {
  s = String(s || "");
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
function escapeAttr(s) {
  return escapeHtml(s).replace(/'/g, "&#39;");
}

/* =========================================================
   13. BIND + INIT
   ========================================================= */
function bindUi() {
  els.btnProcess.addEventListener("click", processOrder);
  els.btnNew.addEventListener("click", newOrder);
  els.btnSettings.addEventListener("click", openSettings);
  els.btnTheme.addEventListener("click", () =>
    applyTheme(state.theme === "dark" ? "light" : "dark")
  );
  els.btnFixAll.addEventListener("click", fixAll);
  els.btnCopyExcel.addEventListener("click", copyExcel);
  els.btnAssist.addEventListener("click", handleAssist);
  els.assistInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleAssist();
    }
  });

  $("btnCloseSettings").addEventListener("click", closeSettings);
  $("btnSaveSettings").addEventListener("click", saveSettings);
  $("btnToggleKey").addEventListener("click", () => {
    const inp = $("apiKeyInput");
    const btn = $("btnToggleKey");
    if (inp.type === "password") {
      inp.type = "text";
      btn.textContent = "Hide";
    } else {
      inp.type = "password";
      btn.textContent = "Show";
    }
  });
  $("masterFileInput").addEventListener("change", onMasterUpload);
  $("btnExportRules").addEventListener("click", exportRules);
  $("importRulesInput").addEventListener("change", importRules);
  $("btnClearRules").addEventListener("click", clearRules);
  $("btnConfirmYes").addEventListener("click", () => finishConfirm(true));
  $("btnConfirmNo").addEventListener("click", () => finishConfirm(false));

  els.fileInput.addEventListener("change", () => {
    state.files.push(...els.fileInput.files);
    els.fileInput.value = "";
    renderPreview();
  });

  // drag drop
  ["dragenter", "dragover"].forEach((ev) => {
    els.dropZone.addEventListener(ev, (e) => {
      e.preventDefault();
      els.dropZone.classList.add("dragover");
    });
  });
  ["dragleave", "drop"].forEach((ev) => {
    els.dropZone.addEventListener(ev, (e) => {
      e.preventDefault();
      els.dropZone.classList.remove("dragover");
    });
  });
  els.dropZone.addEventListener("drop", (e) => {
    const files = [...(e.dataTransfer?.files || [])];
    if (files.length) {
      state.files.push(...files);
      renderPreview();
    }
  });

  // viewport keyboard
  const applyVH = () => {
    try {
      if (window.visualViewport) {
        els.app.style.height = Math.round(window.visualViewport.height) + "px";
      }
    } catch (_) {}
  };
  window.visualViewport?.addEventListener("resize", applyVH);
  window.addEventListener("resize", applyVH);
  applyVH();
}

async function init() {
  applyTheme(state.theme);
  setupPdfJs();
  bindUi();
  seedAndPurge();
  updateChrome();
  renderTable();
  assist("bot", "Ready. Upload PO (left) → <b>Generate Match</b> · fuzzy master on right.");

  // async master — UI stays responsive
  await loadMasterAsync();
  updateChrome();
  assist("bot", `Master loaded: <b>${state.master.length}</b> products · Rules <b>${state.rules.length}</b>`);

  if (!state.apiKey) {
    setTimeout(() => openSettings(), 500);
  }

  if ("serviceWorker" in navigator) {
    try {
      await navigator.serviceWorker.register("./sw.js");
    } catch (_) {}
  }
}

init();
