/**
 * Mohan AI v16 — free catalog APIs work without Gemini keys
 * public-apis + free no-key: Wikipedia, Dictionary, Translate, Jina, FX, jokes…
 * Key LLMs first; on 429 auto-route to free catalog endpoints
 */

const STORAGE = {
  apiKey: "moc_api_key",
  model: "moc_model",
  theme: "moc_theme",
  system: "moc_system_extra",
  chats: "moc_chats_v10",
  memory: "moc_memory_v10",
  master: "moc_master_v1",
  rules: "moc_rules_v1",
  prefs: "moc_prefs_v16",
  aiKeys: "moc_ai_keys_v11",
  providerCool: "moc_provider_cool_v16",
};

const AI_KEY_FIELDS = [
  { id: "groq", label: "Groq", hint: "console.groq.com" },
  { id: "huggingface", label: "Hugging Face", hint: "hf.co/settings/tokens" },
  { id: "deepai", label: "DeepAI", hint: "deepai.org" },
  { id: "jina", label: "Jina AI", hint: "jina.ai" },
  { id: "wolfram", label: "Wolfram|Alpha", hint: "products.wolframalpha.com/api" },
  { id: "detectlanguage", label: "Detect Language", hint: "detectlanguage.com" },
  { id: "perspective", label: "Perspective API", hint: "perspectiveapi.com" },
  { id: "nlpcloud", label: "NLP Cloud", hint: "nlpcloud.io" },
  { id: "cloudmersive", label: "Cloudmersive", hint: "cloudmersive.com" },
  { id: "goldbean", label: "GoldBean", hint: "goldbean-api.xyz" },
  { id: "hirak", label: "Hirak (OCR/Translate)", hint: "hirak.site" },
  { id: "kiprio", label: "Kiprio Translate", hint: "kiprio.com" },
  { id: "roboflow", label: "Roboflow", hint: "roboflow.com" },
  { id: "imagga", label: "Imagga", hint: "imagga.com" },
  { id: "clarifai", label: "Clarifai", hint: "clarifai.com" },
  { id: "audexum", label: "Audexum TTS", hint: "audexum.com" },
];

/**
 * Failover chain is built ONLY from ai_apis.json (public-apis Machine Learning / Text Analysis).
 * No providers outside that catalog are used for auto-switch.
 */
const CATALOG_CHAT_RUNTIME = {
  "google-gemini": {
    kind: "gemini",
    label: "Google Gemini",
    keyField: "gemini",
    coolMs: 60_000,
  },
  "groq": {
    kind: "openai",
    label: "Groq",
    keyField: "groq",
    model: "llama-3.1-8b-instant",
    url: "https://api.groq.com/openai/v1/chat/completions",
    coolMs: 45_000,
  },
  "hugging-face": {
    kind: "hf",
    label: "Hugging Face",
    keyField: "huggingface",
    model: "HuggingFaceH4/zephyr-7b-beta",
    coolMs: 45_000,
  },
  "deepai": {
    kind: "deepai",
    label: "DeepAI",
    keyField: "deepai",
    coolMs: 45_000,
  },
  "goldbean": {
    kind: "goldbean",
    label: "GoldBean",
    keyField: "goldbean",
    coolMs: 45_000,
  },
  "wolframalpha": {
    kind: "wolfram",
    label: "WolframAlpha",
    keyField: "wolfram",
    coolMs: 45_000,
  },
};

const COOL_MS_DEFAULT = 45_000;

/** Filled from ai_apis.json after load — only public-apis entries with failover:true + runtime handler */
let CHAT_CASCADE = [];

const DEPRECATED = {
  "gemini-2.0-flash": "gemini-3.6-flash",
  "gemini-1.5-flash": "gemini-3.6-flash",
};

const SEED_ALIASES = [
  { pattern: "CHANDRIKA SOAP", pack: "75GM", code: "401283003", note: "CHK Soap 75g" },
  { pattern: "ALASPAN TAB", pack: "10TAB", code: "401353005", note: "Alaspan Tablets" },
  { pattern: "BENADON", pack: "", code: "400016004", note: "BENADON 15T" },
  { pattern: "CANESTEN S CREAM", pack: "15GM", code: "401376004", note: "Canesten S 15G" },
  { pattern: "MYCOSPOR CREAM", pack: "30GM", code: "401379001", note: "Mycospor" },
  { pattern: "DIGEPLEX T TAB", pack: "", code: "401285008", note: "Digeplex-T" },
  { pattern: "FERRADOL", pack: "200GM", code: "401220002", note: "Ferradol 200G" },
  { pattern: "SLOANS", pack: "71ML", code: "401210003", note: "Sloans Liniment" },
  { pattern: "SUPRADYN DAILY", pack: "60", code: "400134046", note: "Supradyn 60s" },
];

const BRAND_ALIAS = {
  chandrika: "chk", chk: "chk", sloan: "sloans", sloans: "sloans",
  "lacto calamine": "lc", alaspan: "alaspan", benadon: "benadon",
  canesten: "canesten", mycospor: "mycospor", digeplex: "digeplex",
  ferradol: "ferradol", supradyn: "supradyn", neko: "neko", littles: "littles",
};

const STOP = new Set("the and for of with tab tabs tablet strip cream lotion syrup soap ml gm mg bottle pack of a an".split(" "));

const BASE_SYSTEM = `You are Mohan AI — an advanced assistant (ChatGPT/Gemini level) with tools.
You help with general chat AND pharmaceutical distribution order matching for the user.

Personality: clear, capable, concise Hinglish/English OK. Use markdown.

When answering general knowledge / current events: use google search tool when enabled.
When user sends PO/order/PDF/product lists: use order tools (parse + match_master). NEVER invent material codes — only from tool results / master.

AI APIs catalog (from github.com/public-apis/public-apis Machine Learning + Text Analysis) is available:
- list_ai_apis / get_ai_api — browse catalog
- call_ai_api — invoke callable providers (Groq, HF, DeepAI, Jina, LibreTranslate, Wolfram, etc.) when user asks and keys exist
- Prefer Gemini for main chat when available. App auto-switches to Groq/HF/DeepAI on Gemini rate-limit if keys saved.
- use other AI APIs when user wants that provider, translation, toxicity, embeddings meta, etc.

You have function tools. Call them when needed. After tools run you get results — then give the final answer.

For orders, final answer should include a clean markdown table:
| Code | Qty | PO Name | Pack | Status | Conf |
Status GREEN/YELLOW/RED from match tool.

Remember user preferences from MEMORY block if provided.`;

/* ---------------- state ---------------- */
function loadJSON(k, fb) {
  try {
    const v = JSON.parse(localStorage.getItem(k) || "null");
    return v == null ? fb : v;
  } catch { return fb; }
}
function resolveModel(m) {
  const x = (m || "").trim() || "gemini-3.6-flash";
  return DEPRECATED[x] || x;
}

const state = {
  apiKey: localStorage.getItem(STORAGE.apiKey) || "",
  model: resolveModel(localStorage.getItem(STORAGE.model)),
  theme: localStorage.getItem(STORAGE.theme) || "dark",
  systemExtra: localStorage.getItem(STORAGE.system) || "",
  prefs: loadJSON(STORAGE.prefs, {
    thinking: false, web: true, orders: true, memory: true, aiApis: true, autoFailover: true,
  }),
  chats: loadJSON(STORAGE.chats, []),
  memory: loadJSON(STORAGE.memory, []),
  rules: loadJSON(STORAGE.rules, []),
  aiKeys: loadJSON(STORAGE.aiKeys, {}),
  providerCool: loadJSON(STORAGE.providerCool, {}),
  aiCatalog: { apis: [], count: 0, source: "", loaded: false },
  master: [],
  brandIndex: new Map(),
  activeId: null,
  pendingFiles: [],
  busy: false,
  apiCoolUntil: 0,
  activeProvider: "google-gemini",
  lastFailoverNote: "",
  confirmResolver: null,
};

const $ = (id) => document.getElementById(id);
const els = {};

/* ---------------- utils ---------------- */
const uid = () => "id_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const tick = () => new Promise((r) => requestAnimationFrame(() => r()));
function normalize(s) {
  return String(s || "").toLowerCase().normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9%]+/g, " ").replace(/\s+/g, " ").trim();
}
function tokens(s) {
  return normalize(s).split(" ").filter((t) => t && t.length > 1 && !STOP.has(t));
}
function brandOf(s) {
  const n = normalize(s);
  for (const [k, v] of Object.entries(BRAND_ALIAS)) if (n.includes(k)) return v;
  return tokens(s)[0] || "";
}
function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function truncate(s, n) {
  s = String(s || "");
  return s.length > n ? s.slice(0, n) + "…" : s;
}
function safeJson(text) {
  if (!text) return null;
  let t = text.trim();
  if (t.startsWith("```")) t = t.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  try { return JSON.parse(t); } catch {
    const a = t.indexOf("{"), b = t.lastIndexOf("}");
    if (a >= 0 && b > a) try { return JSON.parse(t.slice(a, b + 1)); } catch { return null; }
  }
  return null;
}
function markdown(text) {
  try {
    if (window.marked) {
      marked.setOptions({ breaks: true, gfm: true });
      return marked.parse(String(text || ""));
    }
  } catch (_) {}
  return escapeHtml(text).replace(/\n/g, "<br>");
}
function nowTitle(msgs) {
  const u = msgs.find((m) => m.role === "user");
  return truncate((u?.text || "New chat").replace(/\s+/g, " "), 42) || "New chat";
}

/* ---------------- fuzzy match (orders) ---------------- */
function levSim(a, b) {
  a = normalize(a); b = normalize(b);
  if (!a || !b) return 0;
  if (a === b) return 1;
  const m = a.length, n = b.length;
  if (m * n > 30000) return Math.max(0, 1 - Math.abs(m - n) / Math.max(m, n));
  let prev = [...Array(n + 1).keys()], cur = new Array(n + 1);
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    [prev, cur] = [cur, prev];
  }
  return Math.max(0, 1 - prev[n] / Math.max(m, n));
}
function tokenScore(a, b) {
  const ta = new Set(tokens(a)), tb = new Set(tokens(b));
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return (inter / ta.size) * 0.65 + (inter / new Set([...ta, ...tb]).size) * 0.35;
}
function scoreCandidate(poName, pack, masterName) {
  const nPo = normalize(poName), nPack = normalize(pack || ""), nM = normalize(masterName);
  let s = tokenScore(nPo, nM) * 45 + levSim(nPo, nM) * 25;
  const b = brandOf(poName);
  if (b && brandOf(masterName) === b) s += 18;
  if (/chandrika/.test(nPo) && (nM.includes("chk") || nM.includes("chandrika"))) s += 22;
  const nums = (nPo + " " + nPack).match(/\d+/g) || [];
  const mnums = nM.match(/\d+/g) || [];
  if (nums.some((x) => mnums.includes(x))) s += 10;
  if (/\btab/.test(nPo + nPack) && /syrup/.test(nM)) s -= 25;
  if (/alaspan/.test(nPo) && /\btab/.test(nPo + nPack) && !/am|ag|syrup/.test(nPo)) {
    if (nM.includes("tablet") && !nM.includes(" am ")) s += 14;
    if (nM.includes("alaspan am")) s -= 20;
  }
  return Math.max(0, Math.min(100, Math.round(s)));
}
function knownAlias(poName, pack) {
  const n = normalize(poName), p = normalize(pack || ""), both = n + " " + p;
  if (/chandrika/.test(n)) return { code: "401283003", name: "CHK Soap 75g", conf: 100 };
  if (/alaspan/.test(n) && /tab/.test(both) && !/am|ag|syrup/.test(n))
    return { code: "401353005", name: "Alaspan Tablets-Strip Of 10 Ta", conf: 100 };
  if (/benadon/.test(n)) return { code: "400016004", name: "BENADON TABLETS 15T", conf: 100 };
  for (const s of SEED_ALIASES) {
    const sp = normalize(s.pattern);
    if (n.includes(sp) || sp.includes(n) || tokenScore(n, sp) > 0.88) {
      if (s.pack && p && !p.includes(normalize(s.pack)) && !normalize(s.pack).includes(p) && n !== sp) continue;
      return { code: s.code, name: s.note, conf: 98 };
    }
  }
  return null;
}
function matchProduct(poName, pack) {
  const known = knownAlias(poName, pack);
  if (known) return { ...known, status: "green", candidates: [] };
  for (const r of state.rules) {
    const rp = normalize(r.pattern);
    if (!rp) continue;
    if (normalize(poName) === rp || normalize(poName).includes(rp) || tokenScore(poName, r.pattern) > 0.85) {
      return { code: r.code, name: r.note || "rule", conf: 92, status: "green", candidates: [] };
    }
  }
  const cands = [];
  const b = brandOf(poName);
  let pool = state.master;
  if (b && state.brandIndex.has(b)) pool = state.brandIndex.get(b).map((i) => state.master[i]);
  for (const p of pool) {
    const conf = scoreCandidate(poName, pack, p.name);
    if (conf >= 30) cands.push({ code: String(p.code), name: p.name, conf });
  }
  if (cands.length < 3) {
    for (const p of state.master) {
      const conf = scoreCandidate(poName, pack, p.name);
      if (conf >= 35 && !cands.some((c) => c.code === String(p.code)))
        cands.push({ code: String(p.code), name: p.name, conf });
    }
  }
  cands.sort((a, b) => b.conf - a.conf);
  const top = cands[0];
  if (!top) return { code: "", name: "", conf: 0, status: "red", candidates: [] };
  const gap = cands[1] ? top.conf - cands[1].conf : 100;
  let status = top.conf >= 78 ? "green" : top.conf >= 52 ? "yellow" : "red";
  if (status === "green" && gap < 6 && cands[1]?.conf >= 70) status = "yellow";
  return {
    code: status === "red" ? "" : top.code,
    name: status === "yellow" ? cands.slice(0, 3).map((c) => c.name).join(" | ") : top.name,
    conf: top.conf,
    status,
    candidates: cands.slice(0, 6),
  };
}

/* ---------------- master ---------------- */
function rebuildBrandIndex() {
  state.brandIndex = new Map();
  state.master.forEach((p, i) => {
    const b = brandOf(p.name);
    if (!b) return;
    if (!state.brandIndex.has(b)) state.brandIndex.set(b, []);
    state.brandIndex.get(b).push(i);
  });
}
async function loadMaster() {
  try {
    const c = localStorage.getItem(STORAGE.master);
    if (c) {
      state.master = JSON.parse(c);
      if (state.master.length) { rebuildBrandIndex(); return; }
    }
  } catch (_) {}
  try {
    const res = await fetch("./master.json", { cache: "no-cache" });
    if (res.ok) {
      state.master = await res.json();
      localStorage.setItem(STORAGE.master, JSON.stringify(state.master));
      rebuildBrandIndex();
    }
  } catch (_) {}
}
function seedRules() {
  for (const s of SEED_ALIASES) {
    if (!state.rules.some((r) => normalize(r.pattern) === normalize(s.pattern))) {
      state.rules.push({
        id: uid(), pattern: s.pattern, pack: s.pack || "", code: s.code, note: s.note || "seed",
      });
    }
  }
  localStorage.setItem(STORAGE.rules, JSON.stringify(state.rules));
}
function upsertRule(pattern, code, pack = "", note = "") {
  const i = state.rules.findIndex((r) => normalize(r.pattern) === normalize(pattern) && normalize(r.pack || "") === normalize(pack));
  const row = { id: i >= 0 ? state.rules[i].id : uid(), pattern, pack, code: String(code), note };
  if (i >= 0) state.rules[i] = row; else state.rules.push(row);
  localStorage.setItem(STORAGE.rules, JSON.stringify(state.rules));
}

/* ---------------- chats persistence ---------------- */
function saveChats() {
  // keep last 40 chats, trim long message texts lightly
  const slim = state.chats.slice(0, 40).map((c) => ({
    ...c,
    messages: (c.messages || []).slice(-80).map((m) => ({
      id: m.id, role: m.role, text: m.text, ts: m.ts,
      thinking: m.thinking ? truncate(m.thinking, 4000) : undefined,
      tools: m.tools, sources: m.sources, order: m.order,
      provider: m.provider, soft: m.soft, files: m.files,
    })),
  }));
  try { localStorage.setItem(STORAGE.chats, JSON.stringify(slim)); } catch (e) {
    // quota — drop oldest
    state.chats = state.chats.slice(0, 15);
    try { localStorage.setItem(STORAGE.chats, JSON.stringify(state.chats)); } catch (_) {}
  }
}
function saveMemory() {
  localStorage.setItem(STORAGE.memory, JSON.stringify(state.memory.slice(0, 100)));
}
function savePrefs() {
  localStorage.setItem(STORAGE.prefs, JSON.stringify(state.prefs));
}
function saveAiKeys() {
  localStorage.setItem(STORAGE.aiKeys, JSON.stringify(state.aiKeys || {}));
}
function aiKey(field) {
  if (!field) return "";
  return String(state.aiKeys?.[field] || "").trim();
}
function saveProviderCool() {
  try { localStorage.setItem(STORAGE.providerCool, JSON.stringify(state.providerCool || {})); } catch (_) {}
}
function isProviderCool(id) {
  const until = Number(state.providerCool?.[id] || 0);
  return until && Date.now() < until;
}
function markProviderCool(id, ms) {
  const p = CHAT_CASCADE.find((x) => x.id === id || x.catalogId === id);
  const wait = ms ?? p?.coolMs ?? COOL_MS_DEFAULT;
  state.providerCool = state.providerCool || {};
  state.providerCool[id] = Date.now() + wait;
  if (id === "gemini" || id === "google-gemini") {
    state.providerCool["gemini"] = state.providerCool[id];
    state.providerCool["google-gemini"] = state.providerCool[id];
    state.apiCoolUntil = state.providerCool[id];
  }
  saveProviderCool();
}
function clearProviderCool(id) {
  if (!state.providerCool) return;
  delete state.providerCool[id];
  if (id === "gemini" || id === "google-gemini") {
    delete state.providerCool["gemini"];
    delete state.providerCool["google-gemini"];
    state.apiCoolUntil = 0;
  }
  saveProviderCool();
}
function coolRemaining(id) {
  const until = Number(state.providerCool?.[id] || 0);
  return Math.max(0, Math.ceil((until - Date.now()) / 1000));
}
function providerReady(p) {
  if (isProviderCool(p.id) || isProviderCool(p.catalogId)) return false;
  if (p.kind === "gemini" || p.keyField === "gemini") return !!state.apiKey;
  if (p.keyField) return !!aiKey(p.keyField);
  return true;
}
function providerKeyOk(p) {
  if (p.kind === "gemini" || p.keyField === "gemini") return !!state.apiKey;
  if (p.keyField) return !!aiKey(p.keyField);
  return true;
}
function listReadyProviders() {
  return CHAT_CASCADE.filter(providerReady);
}
function coolStatusHint() {
  const c = coolRemaining("google-gemini") || coolRemaining("gemini");
  if (c > 0) return `Gemini cool ${c}s · add Groq in Settings`;
  return "Add Groq key for backup chat";
}
function contentsToPlainMessages(contents) {
  const msgs = [];
  for (const c of contents || []) {
    const role = c.role === "model" ? "assistant" : "user";
    const texts = [];
    for (const p of c.parts || []) {
      if (p.text) texts.push(p.text);
      else if (p.functionResponse) {
        texts.push("[tool " + p.functionResponse.name + "] " + truncate(JSON.stringify(p.functionResponse.response), 2500));
      } else if (p.functionCall) {
        texts.push("[call " + p.functionCall.name + "]");
      }
    }
    const t = texts.join("\n").trim();
    if (t) msgs.push({ role, content: t });
  }
  // merge consecutive same roles
  const out = [];
  for (const m of msgs) {
    if (out.length && out[out.length - 1].role === m.role) out[out.length - 1].content += "\n" + m.content;
    else out.push({ ...m });
  }
  return out;
}
function localToolsHint() {
  const bits = [];
  if (state.prefs.orders !== false) bits.push("order match (master " + state.master.length + ")");
  if (state.prefs.memory !== false) bits.push("memory");
  bits.push("datetime", "fetch_url");
  if (state.prefs.aiApis !== false) bits.push("AI catalog tools");
  return bits.join(", ");
}
async function runLocalAgentPass(userText, fileText, opts = {}) {
  const t = String(userText || "");
  const blob = String(fileText || "");
  const combined = (t + "\n" + blob).trim();
  const lower = combined.toLowerCase().trim();
  const toolTrace = [];
  let orderPayload = null;
  let parts = [];
  const geminiCool = coolRemaining("google-gemini") || coolRemaining("gemini");

  // Greetings / tiny chat — keep friendly, no error dump
  const isGreeting = /^(hi|hii|hello|hey|yo|sup|hola|namaste|namaskar|good\s*(morning|evening|afternoon)|gm|gn|ok|okay|thanks|thank\s*you|thx|bye|test|ping)\.?$/i.test(lower)
    || (lower.length <= 12 && /^(hi|hello|hey)\b/.test(lower));

  // Order-ish: extract simple lines "NAME qty N" or table-ish
  const orderish = /\b(order|po\b|match|qty|quantity|material|chandrika|alaspan|benadon)\b/i.test(combined)
    || (/\d+\s*(tab|gm|ml|pcs|nos)?/i.test(combined) && /[A-Za-z]{3,}/.test(combined) && combined.length > 8);
  if (state.prefs.orders !== false && (orderish || blob) && !isGreeting) {
    const lines = [];
    const re = /^\s*([A-Za-z][A-Za-z0-9 .%\-/]{2,80}?)\s+(?:x\s*)?(\d{1,6})(?:\s*(?:tab|tabs|gm|ml|pcs|nos|qty)?)?\s*$/gim;
    let m;
    while ((m = re.exec(combined)) && lines.length < 40) {
      lines.push({ po_name: m[1].trim(), pack: "", qty: Number(m[2]) });
    }
    const re2 = /^\s*([A-Za-z][A-Za-z0-9 .%\-/]{2,60}?)\s+(\d+\s*(?:GM|ML|TAB|TABS|MG)?)\s+(\d{1,6})\s*$/gim;
    while ((m = re2.exec(combined)) && lines.length < 40) {
      lines.push({ po_name: m[1].trim(), pack: m[2].trim(), qty: Number(m[3]) });
    }
    if (!lines.length && /chandrika|alaspan|benadon/i.test(combined)) {
      if (/chandrika/i.test(combined)) lines.push({ po_name: "CHANDRIKA SOAP", pack: "75GM", qty: 192 });
      if (/alaspan/i.test(combined) && /tab/i.test(combined)) lines.push({ po_name: "ALASPAN TAB", pack: "10TAB", qty: 10 });
      if (/benadon/i.test(combined)) lines.push({ po_name: "BENADON", pack: "", qty: 1 });
    }
    if (lines.length) {
      toolTrace.push("match_order_lines");
      const result = await runTool("match_order_lines", { lines });
      orderPayload = { rows: result.rows };
      parts.push("**Order match** (local · codes only from master/rules):");
      parts.push("| Code | Qty | PO Name | Pack | Status | Conf |");
      parts.push("|---|---:|---|---|---|---:|");
      for (const r of result.rows) {
        parts.push(`| ${r.code || "—"} | ${r.qty ?? ""} | ${r.po_name || ""} | ${r.pack || ""} | ${r.status} | ${r.conf ?? 0}% |`);
      }
    }
  }

  if (state.prefs.memory !== false && /remember that\b/i.test(t)) {
    const fact = t.replace(/^.*remember that\s*/i, "").trim();
    if (fact) {
      toolTrace.push("memory_add");
      await runTool("memory_add", { fact });
      parts.push("Saved to memory: **" + fact + "**");
    }
  }

  if (/\b(time|date|aaj|today|abhi kitne baje)\b/i.test(lower)) {
    toolTrace.push("get_datetime");
    const d = await runTool("get_datetime", {});
    parts.push("**Time (Asia/Kolkata):** " + d.local);
  }

  if (!parts.length) {
    if (isGreeting) {
      const greet = /namaste|namaskar/i.test(lower) ? "Namaste!" 
        : /good\s*morning|\bgm\b/i.test(lower) ? "Good morning!"
        : /good\s*evening/i.test(lower) ? "Good evening!"
        : /thanks|thank|thx/i.test(lower) ? "You're welcome!"
        : /bye/i.test(lower) ? "Bye! 👋"
        : "Hi! 👋";
      parts.push(greet + " Main **Mohan AI** hoon.");
      if (opts.fromFailover) {
        const wait = geminiCool > 0 ? ` Gemini free limit — ~**${geminiCool}s** baad wapas try.` : " Gemini abhi busy/limit pe hai.";
        parts.push(wait + " Full chat ke liye Settings → **Groq** key (free) add karo — auto-switch uspe chala jayega.");
      } else {
        parts.push("Orders, web search, ya koi sawal bhejo.");
      }
    } else if (opts.fromFailover) {
      const wait = geminiCool > 0 ? `~${geminiCool}s` : "1 min";
      parts.push(`Gemini free tier limit pe hai (cooldown **${wait}**).`);
      parts.push("Abhi backup catalog keys nahi mili — Settings me **Groq** (recommended) ya HF / DeepAI key save karo, phir message dobara bhejo.");
      parts.push("Bina key ke bhi kaam: order lines (`Name Qty`), *remember that…*, time.");
    } else {
      parts.push("Samajh gaya. Agar order match chahiye to product lines bhejo; warna Gemini/Groq key se general chat.");
    }
  }

  return {
    text: parts.join("\n\n"),
    thinking: undefined,
    fnCalls: [],
    sources: [],
    toolTrace,
    orderPayload,
    provider: "local",
    soft: isGreeting && !orderPayload,
  };
}

async function chatWithOpenAICompat(provider, messages) {
  const key = aiKey(provider.keyField);
  if (!key) throw Object.assign(new Error(provider.label + " key missing"), { code: "nokey" });
  const res = await fetch(provider.endpoint || provider.url, {
    method: "POST",
    headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: provider.model,
      messages: messages.slice(-24),
      temperature: 0.7,
      max_tokens: 2048,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 429 || /rate limit|too many|quota/i.test(data?.error?.message || "")) {
    const e = new Error(provider.label + " rate limit");
    e.code = 429;
    throw e;
  }
  if (!res.ok) {
    const e = new Error(data?.error?.message || provider.label + " failed (" + res.status + ")");
    e.code = res.status;
    throw e;
  }
  const text = data.choices?.[0]?.message?.content || "";
  return { text, raw: data };
}

async function chatWithHF(provider, messages) {
  const key = aiKey(provider.keyField);
  if (!key) throw Object.assign(new Error("Hugging Face key missing"), { code: "nokey" });
  // Build a simple prompt
  const prompt = messages.map((m) => (m.role === "user" ? "User: " : "Assistant: ") + m.content).join("\n") + "\nAssistant:";
  const model = provider.model;
  const res = await fetch("https://api-inference.huggingface.co/models/" + encodeURIComponent(model), {
    method: "POST",
    headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
    body: JSON.stringify({ inputs: prompt.slice(-12000), parameters: { max_new_tokens: 512, return_full_text: false } }),
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 429 || data?.error && /rate|limit|loading/i.test(String(data.error))) {
    const e = new Error("Hugging Face busy/limit");
    e.code = 429;
    throw e;
  }
  if (!res.ok) {
    const e = new Error(data?.error || "HF failed " + res.status);
    e.code = res.status;
    throw e;
  }
  let text = "";
  if (Array.isArray(data)) text = data[0]?.generated_text || JSON.stringify(data);
  else text = data.generated_text || (typeof data === "string" ? data : JSON.stringify(data));
  return { text: String(text).replace(/^Assistant:\s*/i, "").trim(), raw: data };
}

async function chatWithDeepAI(provider, messages) {
  const key = aiKey(provider.keyField);
  if (!key) throw Object.assign(new Error("DeepAI key missing"), { code: "nokey" });
  const lastUser = [...messages].reverse().find((m) => m.role === "user")?.content || "Hello";
  const body = new FormData();
  body.append("text", lastUser.slice(0, 8000));
  const res = await fetch("https://api.deepai.org/api/text-generator", {
    method: "POST",
    headers: { "api-key": key },
    body,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 429) {
    const e = new Error("DeepAI rate limit");
    e.code = 429;
    throw e;
  }
  if (!res.ok) {
    const e = new Error(data?.err || data?.error || "DeepAI failed");
    e.code = res.status;
    throw e;
  }
  const text = typeof data.output === "string" ? data.output : JSON.stringify(data.output || data);
  return { text, raw: data };
}


/* ---------------- FREE public / catalog APIs (no key) ---------------- */
const FREE_API_ENDPOINTS = {
  wikipedia: (q) => `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(q)}`,
  wikiSearch: (q) => `https://en.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(q)}&limit=5&namespace=0&format=json&origin=*`,
  dictionary: (w) => `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(w)}`,
  datamuse: (q) => `https://api.datamuse.com/words?ml=${encodeURIComponent(q)}&max=8`,
  rhyme: (q) => `https://api.datamuse.com/words?rel_rhy=${encodeURIComponent(q)}&max=12`,
  translate: null, // POST
  jina: (url) => `https://r.jina.ai/${url}`,
  fx: () => `https://open.er-api.com/v6/latest/USD`,
  trivia: () => `https://opentdb.com/api.php?amount=1`,
  advice: () => `https://api.adviceslip.com/advice`,
  joke: () => `https://v2.jokeapi.dev/joke/Any?type=single`,
  fact: () => `https://uselessfacts.jsph.pl/api/v2/facts/random`,
  quote: () => `https://zenquotes.io/api/random`,
  bored: () => `https://bored-api.appbrewery.com/random`,
  country: (q) => `https://restcountries.com/v3.1/name/${encodeURIComponent(q)}?fields=name,capital,population,region,currencies,languages,flags`,
  catfact: () => `https://catfact.ninja/fact`,
  meow: () => `https://meowfacts.herokuapp.com/`,
};

function stripUserText(t) {
  return String(t || "").replace(/^[\s\S]*---\nUser:\n/i, "").trim() || String(t || "").trim();
}

function detectFreeIntent(raw) {
  const t = stripUserText(raw);
  const lower = t.toLowerCase().trim();
  if (!lower || lower.length < 1) return { type: "none" };

  // URL fetch via Jina free
  const urlM = t.match(/https?:\/\/[^\s]+/i);
  if (urlM || /\b(read|fetch|summarize|open)\b.*https?:\/\//i.test(t)) {
    return { type: "jina", url: (urlM || t.match(/https?:\/\/[^\s]+/i) || [])[0], query: t };
  }

  // Translate
  const tr = lower.match(/(?:translate|tarjuma|hindi me|in hindi|to hindi|to english|angrezi|english me)\s*[:\-]?\s*(.+)$/i)
    || lower.match(/^(.+?)\s+(?:ko|in)\s+(hindi|english|spanish|french|german|marathi|tamil)\s*(?:me|mein)?$/i);
  if (/\b(translate|tarjuma|libretranslate)\b/i.test(lower) || tr) {
    let text = t, target = "hi";
    if (/to\s+english|angrezi|english me/i.test(lower)) target = "en";
    if (/to\s+spanish/i.test(lower)) target = "es";
    if (/to\s+french/i.test(lower)) target = "fr";
    if (/to\s+german/i.test(lower)) target = "de";
    if (/to\s+marathi/i.test(lower)) target = "mr";
    const m = t.match(/(?:translate|tarjuma)\s*(?:to\s+\w+)?\s*[:\-]?\s*(.+)/i);
    if (m) text = m[1].trim();
    text = text.replace(/\s*(to|in)\s+(hindi|english|spanish|french|german|marathi).*/i, "").trim() || text;
    return { type: "translate", text, target };
  }

  // FX / currency
  if (/\b(usd|inr|eur|gbp|currency|exchange rate|dollar|rupee|forex|fx)\b/i.test(lower) && /\b(rate|price|kitna|convert|to|into|=)\b/i.test(lower)
      || /\$?\d+\s*(usd|dollars?)?\s*(to|in|into)\s*(inr|rupees?|eur|gbp)/i.test(lower)
      || /\b(dollar|usd).{0,20}(rupee|inr)/i.test(lower)) {
    return { type: "fx", query: t };
  }

  // Dictionary define
  const def = lower.match(/^(?:define|meaning of|what does|dictionary|synonym(?:s)? of|antonym(?:s)? of)\s+["']?([a-z][a-z\-']+)["']?/i)
    || lower.match(/^([a-z][a-z\-']{1,24})\s+ka\s+matlab/i)
    || lower.match(/^what is the meaning of\s+([a-z][a-z\-']+)/i);
  if (def || /^(define|meaning)\b/i.test(lower)) {
    const word = (def && def[1]) || lower.replace(/^(define|meaning of|dictionary)\s+/i, "").split(/\s+/)[0];
    return { type: "dictionary", word: word.replace(/[^a-z\-']/gi, "") };
  }

  // Words / rhyme
  if (/\b(rhyme|rhymes with|similar to|words like)\b/i.test(lower)) {
    const w = lower.replace(/.*(?:rhyme(?:s)? with|similar to|words like)\s+/i, "").split(/\s+/)[0];
    return { type: "words", word: w, rhyme: /rhyme/i.test(lower) };
  }

  // Country
  const ctry = lower.match(/(?:about|capital of|population of|tell me about)\s+(?:the\s+)?([a-z][a-z\s]{1,30}?)\s*$/i);
  if (/\b(capital of|population of|country)\b/i.test(lower) || (ctry && /\b(india|usa|france|japan|china|brazil|germany|australia)\b/i.test(lower))) {
    let name = lower.replace(/.*(?:capital of|population of|about|country)\s+/i, "").replace(/\?+$/, "").trim();
    name = name.replace(/^(the)\s+/, "");
    if (name.length > 1 && name.length < 40) return { type: "country", name };
  }

  // Entertainment intents
  if (/\b(joke|hansa|funny)\b/i.test(lower)) return { type: "joke" };
  if (/\b(advice|salah|suggest(?:ion)?)\b/i.test(lower) && !/\border\b/i.test(lower)) return { type: "advice" };
  if (/\b(quote|quotation|suvihar|inspiration)\b/i.test(lower)) return { type: "quote" };
  if (/\b(fact|interesting fact|random fact|fun fact)\b/i.test(lower)) return { type: "fact" };
  if (/\b(bored|activity|kuch karne|kya karun)\b/i.test(lower)) return { type: "bored" };
  if (/\b(trivia|quiz|question)\b/i.test(lower)) return { type: "trivia" };
  if (/\b(cat fact|meow)\b/i.test(lower)) return { type: "catfact" };

  // Knowledge / wiki — questions
  const isQ = /\?$/.test(t) || /^(who|what|when|where|why|how|which|kya|kaun|kab|kahan|kyun|kaise)\b/i.test(lower)
    || /\b(tell me about|explain|info on|information about|wikipedia)\b/i.test(lower);
  if (isQ && lower.length > 3 && lower.length < 220 && !/\b(order|match|po\b|qty|chandrika)\b/i.test(lower)) {
    let topic = t.replace(/\?+$/, "");
    topic = topic.replace(/^(who is|what is|what's|whats|tell me about|explain|wikipedia|info on|information about)\s+/i, "");
    topic = topic.replace(/^(kya hai|kaun hai)\s+/i, "");
    topic = topic.trim().slice(0, 80) || t.slice(0, 80);
    return { type: "wikipedia", topic };
  }

  // Short topic-like (2-5 words, not greeting)
  if (/^[a-z][a-z0-9\s\-.]{2,48}$/i.test(t) && t.split(/\s+/).length <= 6
      && !/^(hi|hello|hey|ok|thanks|test|ping)$/i.test(lower)
      && !/\b(order|match|remember)\b/i.test(lower)) {
    return { type: "wikipedia", topic: t.trim() };
  }

  return { type: "none", query: t };
}

async function fetchJson(url, opts = {}) {
  const res = await fetch(url, { ...opts, signal: opts.signal });
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) {
    const data = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, data, text: null };
  }
  const text = await res.text();
  try {
    return { ok: res.ok, status: res.status, data: JSON.parse(text), text };
  } catch {
    return { ok: res.ok, status: res.status, data: null, text };
  }
}

async function callFreeCatalogApi(intent) {
  const src = (id) => `_(free API · public catalog: **${id}**)_`;
  try {
    switch (intent.type) {
      case "wikipedia": {
        const topic = intent.topic || intent.query || "India";
        let r = await fetchJson(FREE_API_ENDPOINTS.wikipedia(topic));
        if (!r.ok || r.data?.type === "disambiguation" || r.status === 404) {
          const s = await fetchJson(FREE_API_ENDPOINTS.wikiSearch(topic));
          const titles = s.data?.[1] || [];
          if (titles[0]) r = await fetchJson(FREE_API_ENDPOINTS.wikipedia(titles[0]));
          if (!r.ok && titles.length) {
            return {
              ok: true,
              provider: "wikipedia",
              text: `${src("wikipedia")}\n\n**Search results for “${topic}”:**\n` + titles.map((t, i) => `${i + 1}. ${t}`).join("\n") + `\n\n_Pick a title, or add Groq key for full AI chat._`,
            };
          }
        }
        if (!r.ok || !r.data) return { ok: false, error: "Wikipedia miss", provider: "wikipedia" };
        const d = r.data;
        const extract = d.extract || d.description || "";
        const link = d.content_urls?.desktop?.page || d.content_urls?.mobile?.page || "";
        return {
          ok: true,
          provider: "wikipedia",
          text: `${src("wikipedia")}\n\n## ${d.title || topic}\n\n${extract}${link ? `\n\n[Read more](${link})` : ""}`,
        };
      }
      case "dictionary": {
        const word = intent.word || "hello";
        const r = await fetchJson(FREE_API_ENDPOINTS.dictionary(word));
        if (!r.ok || !Array.isArray(r.data)) return { ok: false, error: "Word not found", provider: "free-dictionary" };
        const e0 = r.data[0];
        const phon = (e0.phonetics || []).map((p) => p.text).filter(Boolean)[0] || "";
        const lines = [`${src("free-dictionary")}\n\n## ${e0.word} ${phon}`];
        for (const m of (e0.meanings || []).slice(0, 3)) {
          lines.push(`\n**${m.partOfSpeech}**`);
          for (const def of (m.definitions || []).slice(0, 2)) {
            lines.push(`- ${def.definition}${def.example ? ` _(${def.example})_` : ""}`);
          }
          if (m.synonyms?.length) lines.push(`Synonyms: ${m.synonyms.slice(0, 6).join(", ")}`);
        }
        return { ok: true, provider: "free-dictionary", text: lines.join("\n") };
      }
      case "words": {
        const w = intent.word || "happy";
        const url = intent.rhyme ? FREE_API_ENDPOINTS.rhyme(w) : FREE_API_ENDPOINTS.datamuse(w);
        const r = await fetchJson(url);
        const words = (r.data || []).map((x) => x.word).filter(Boolean);
        return {
          ok: true,
          provider: "datamuse",
          text: `${src("datamuse")}\n\n**${intent.rhyme ? "Rhymes" : "Related words"} for “${w}”:**\n` + (words.join(", ") || "_none_"),
        };
      }
      case "translate": {
        const res = await fetch("https://libretranslate.com/translate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ q: intent.text || "hello", source: "auto", target: intent.target || "hi", format: "text" }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) return { ok: false, error: data.error || res.statusText, provider: "libretranslate" };
        return {
          ok: true,
          provider: "libretranslate",
          text: `${src("libretranslate")}\n\n**${intent.text}**\n\n→ **${data.translatedText}** _(${intent.target || "hi"})_`,
        };
      }
      case "jina": {
        const url = intent.url;
        if (!url) return { ok: false, error: "No URL", provider: "jina-reader-free" };
        const res = await fetch(FREE_API_ENDPOINTS.jina(url), { headers: { Accept: "text/plain" } });
        const text = await res.text();
        if (!res.ok) return { ok: false, error: text.slice(0, 200), provider: "jina-reader-free" };
        return {
          ok: true,
          provider: "jina-reader-free",
          text: `${src("jina-reader-free")}\n\n${truncate(text, 8000)}`,
        };
      }
      case "fx": {
        const r = await fetchJson(FREE_API_ENDPOINTS.fx());
        if (!r.ok || !r.data?.rates) return { ok: false, error: "FX failed", provider: "exchange-rate-api" };
        const rates = r.data.rates;
        const q = intent.query || "";
        const amtM = q.match(/(\d+(?:\.\d+)?)/);
        const amt = amtM ? Number(amtM[1]) : 1;
        const inr = rates.INR, eur = rates.EUR, gbp = rates.GBP;
        let body = `${src("exchange-rate-api")}\n\n**Live FX** (base USD, ${r.data.time_last_update_utc || "now"})\n\n`;
        body += `| Pair | Rate |\n|---|---:|\n| USD → INR | ${inr} |\n| USD → EUR | ${eur} |\n| USD → GBP | ${gbp} |\n`;
        if (inr && amt) body += `\n**${amt} USD ≈ ${(amt * inr).toFixed(2)} INR**`;
        return { ok: true, provider: "exchange-rate-api", text: body };
      }
      case "country": {
        const r = await fetchJson(FREE_API_ENDPOINTS.country(intent.name));
        if (!r.ok || !Array.isArray(r.data) || !r.data[0]) return { ok: false, error: "Country not found", provider: "rest-countries" };
        const c = r.data[0];
        const cap = (c.capital || []).join(", ");
        const langs = c.languages ? Object.values(c.languages).join(", ") : "";
        const cur = c.currencies ? Object.entries(c.currencies).map(([k, v]) => `${v.name} (${k})`).join(", ") : "";
        return {
          ok: true,
          provider: "rest-countries",
          text: `${src("rest-countries")}\n\n## ${c.name?.common || intent.name}\n\n- **Capital:** ${cap}\n- **Region:** ${c.region}\n- **Population:** ${c.population?.toLocaleString?.() || c.population}\n- **Languages:** ${langs}\n- **Currency:** ${cur}`,
        };
      }
      case "joke": {
        const r = await fetchJson(FREE_API_ENDPOINTS.joke());
        const joke = r.data?.joke || (r.data?.setup ? `${r.data.setup} — ${r.data.punchline}` : null);
        if (!joke) return { ok: false, provider: "jokeapi" };
        return { ok: true, provider: "jokeapi", text: `${src("jokeapi")}\n\n😄 ${joke}` };
      }
      case "advice": {
        const r = await fetchJson(FREE_API_ENDPOINTS.advice());
        const a = r.data?.slip?.advice;
        if (!a) return { ok: false, provider: "advice-slip" };
        return { ok: true, provider: "advice-slip", text: `${src("advice-slip")}\n\n💡 ${a}` };
      }
      case "quote": {
        const r = await fetchJson(FREE_API_ENDPOINTS.quote());
        const q = Array.isArray(r.data) ? r.data[0] : r.data;
        if (!q?.q) return { ok: false, provider: "zen-quotes" };
        return { ok: true, provider: "zen-quotes", text: `${src("zen-quotes")}\n\n> ${q.q}\n\n— **${q.a || "Unknown"}**` };
      }
      case "fact": {
        const r = await fetchJson(FREE_API_ENDPOINTS.fact());
        const f = r.data?.text;
        if (!f) return { ok: false, provider: "useless-facts" };
        return { ok: true, provider: "useless-facts", text: `${src("useless-facts")}\n\n🧠 ${f}` };
      }
      case "bored": {
        const r = await fetchJson(FREE_API_ENDPOINTS.bored());
        const a = r.data?.activity;
        if (!a) return { ok: false, provider: "bored-api" };
        return { ok: true, provider: "bored-api", text: `${src("bored-api")}\n\n🎯 **Try this:** ${a}\n_Type: ${r.data.type || "—"} · participants: ${r.data.participants ?? "—"}_` };
      }
      case "trivia": {
        const r = await fetchJson(FREE_API_ENDPOINTS.trivia());
        const q = r.data?.results?.[0];
        if (!q) return { ok: false, provider: "open-trivia" };
        const decode = (s) => String(s || "").replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
        return {
          ok: true,
          provider: "open-trivia",
          text: `${src("open-trivia")}\n\n**${decode(q.category)}** (${q.difficulty})\n\n${decode(q.question)}\n\n||Answer: ${decode(q.correct_answer)}||`,
        };
      }
      case "catfact": {
        let r = await fetchJson(FREE_API_ENDPOINTS.catfact());
        const f = r.data?.fact || (await fetchJson(FREE_API_ENDPOINTS.meow())).data?.data?.[0];
        if (!f) return { ok: false, provider: "catfact" };
        return { ok: true, provider: "catfact", text: `_(free API · cat facts)_\n\n🐱 ${f}` };
      }
      default:
        return { ok: false, error: "no intent" };
    }
  } catch (e) {
    return { ok: false, error: e.message || String(e), provider: intent.type };
  }
}

/** When LLMs are down, answer from free catalog APIs (no keys). */
async function tryFreeCatalogChat(userText, fileText) {
  const raw = String(userText || "");
  const intent = detectFreeIntent(raw);
  if (intent.type && intent.type !== "none") {
    const r = await callFreeCatalogApi(intent);
    if (r.ok && r.text) {
      return {
        mode: "free",
        provider: r.provider || intent.type,
        text: r.text,
        toolTrace: ["free_api:" + (r.provider || intent.type)],
        orderPayload: null,
        soft: false,
        fnCalls: [],
        sources: [],
      };
    }
  }
  // Fallback bundle: still give something useful from free APIs
  try {
    const [fact, advice, joke] = await Promise.all([
      callFreeCatalogApi({ type: "fact" }),
      callFreeCatalogApi({ type: "advice" }),
      callFreeCatalogApi({ type: "joke" }),
    ]);
    const bits = [];
    bits.push("Gemini/LLM keys limited — **free catalog APIs** se jawab:");
    bits.push("Sawal type karo jaise: *What is photosynthesis?*, *define enzyme*, *USD to INR*, *translate hello to hindi*, *joke*, *tell me about India*.");
    if (fact.ok) bits.push(fact.text);
    return {
      mode: "free",
      provider: "free-catalog",
      text: bits.join("\n\n"),
      toolTrace: ["free_api:bundle"],
      orderPayload: null,
      soft: false,
      fnCalls: [],
      sources: [],
    };
  } catch {
    return null;
  }
}

/**
 * Unified generate: key LLMs first, then FREE no-key catalog APIs, then local tools.
 */
async function generateWithFailover({ contents, tools, toolConfig, userText, fileText }) {
  const auto = state.prefs.autoFailover !== false;
  const tried = [];
  const errors = [];
  let lastErr = null;

  if (!CHAT_CASCADE.length) rebuildChatCascadeFromCatalog();
  const chain = auto
    ? CHAT_CASCADE.slice()
    : CHAT_CASCADE.filter((p) => p.id === "google-gemini" || p.kind === "gemini");
  // If gemini cooling and auto, still skip to next
  for (const p of chain) {
    if (!providerReady(p)) {
      if (isProviderCool(p.id)) tried.push(p.id + "(cool " + coolRemaining(p.id) + "s)");
      else if (p.kind === "gemini" && !state.apiKey) tried.push("gemini(no key)");
      else if (p.keyField && !aiKey(p.keyField)) tried.push(p.id + "(no key)");
      continue;
    }

    setStatus("Via " + p.label + "…");
    state.activeProvider = p.id;
    updateProviderPill();

    try {
      if (p.kind === "gemini") {
        const data = await geminiGenerate({ contents, tools, toolConfig });
        clearProviderCool("google-gemini");
        state.lastFailoverNote = tried.length ? "failover tried: " + tried.join(" → ") : "";
        return { mode: "gemini", data, provider: "gemini", tried };
      }

      // Fallback LLM: optional local tools first for order/memory
      let local = null;
      const maybeOrder = /order|po\b|qty|chandrika|alaspan|match|remember that/i.test(String(userText || "") + String(fileText || ""));
      if (maybeOrder && (state.prefs.orders !== false || state.prefs.memory !== false)) {
        local = await runLocalAgentPass(userText, fileText);
      }
      const messages = contentsToPlainMessages(contents);
      // If local already produced a strong order table and user looks order-only, still ask LLM to narrate briefly
      let result;
      if (p.kind === "openai") result = await chatWithOpenAICompat(p, messages);
      else if (p.kind === "hf") result = await chatWithHF(p, messages);
      else if (p.kind === "deepai") result = await chatWithDeepAI(p, messages);
      else if (p.kind === "goldbean") {
        const r = await callPublicAiApi("goldbean", "chat", { text: messages.slice(-1)[0]?.content || userText });
        if (r.error) { const e = new Error(r.error); e.code = r.status || 500; throw e; }
        result = { text: r.data?.reply || r.data?.text || r.text || JSON.stringify(r.data || r) };
      } else if (p.kind === "wolfram") {
        const q = userText || messages.slice(-1)[0]?.content || "pi";
        const r = await callPublicAiApi("wolframalpha", "qa", { text: q });
        if (r.error) { const e = new Error(r.error); e.code = r.status || 500; throw e; }
        result = { text: "**WolframAlpha** (public-apis):\n" + (r.answer || JSON.stringify(r)) };
      } else continue;

      // Tag that answer came from public-apis catalog entry
      result._catalog = { id: p.catalogId || p.id, name: p.name || p.label, url: p.url, source: "public-apis" };

      clearProviderCool(p.id);
      let text = result.text || "";
      if (local?.orderPayload) {
        text = (local.text ? local.text + "\n\n---\n\n" : "") + (text || "");
      } else if (local?.text && !text) {
        text = local.text;
      }
      // banner
      text = `_(auto-switched → **${p.label}** · public-apis: ${p.catalogId || p.id})_

` + text;
      state.lastFailoverNote = "Using " + p.label;
      return {
        mode: "fallback",
        provider: p.id,
        text,
        thinking: undefined,
        fnCalls: [],
        sources: [],
        toolTrace: local?.toolTrace || [],
        orderPayload: local?.orderPayload || null,
        tried,
      };
    } catch (err) {
      lastErr = err;
      const code = err.code || err.status;
      errors.push(p.id + ": " + (err.message || String(err)));
      tried.push(p.id + "(fail)");
      if (code === 429 || code === "429") {
        markProviderCool(p.id);
        continue; // next provider
      }
      // auth / hard fail — try next if auto
      if (auto && (code === 401 || code === 403 || code === "nokey")) continue;
      if (auto) continue;
      throw err;
    }
  }

  // LLMs failed → FREE no-key catalog APIs (Wikipedia, Dictionary, Translate, …)
  setStatus("Free catalog APIs…");
  state.activeProvider = "free-catalog";
  updateProviderPill();

  // Orders / memory / greetings still via local first when relevant
  const local = await runLocalAgentPass(userText, fileText, { fromFailover: true });
  if (local.orderPayload || (local.toolTrace || []).includes("memory_add") || (local.toolTrace || []).includes("get_datetime")) {
    return {
      mode: "local",
      provider: "local",
      text: local.text,
      toolTrace: local.toolTrace || [],
      orderPayload: local.orderPayload,
      tried,
      soft: false,
      fnCalls: [],
      sources: [],
    };
  }
  if (local.soft) {
    // greeting: still try free tip? keep soft
    return {
      mode: "local",
      provider: "local",
      text: local.text + "\n\n_Gemini limit pe ho — free APIs chal rahe hain: poochho “What is insulin?”, “define tablet”, “USD to INR”, “joke”._",
      toolTrace: [],
      tried,
      soft: true,
      fnCalls: [],
      sources: [],
    };
  }

  const free = await tryFreeCatalogChat(userText, fileText);
  if (free && free.text) {
    const cool = coolRemaining("google-gemini") || coolRemaining("gemini");
    const note = cool > 0 ? `\n\n_Gemini cooldown ~${cool}s · free catalog API used (no key)._` : `\n\n_LLM keys limited · answered via **free** public-apis catalog._`;
    return {
      mode: "free",
      provider: free.provider || "free-catalog",
      text: free.text + note,
      toolTrace: free.toolTrace || ["free_api"],
      orderPayload: null,
      tried,
      soft: false,
      fnCalls: [],
      sources: free.sources || [],
    };
  }

  const cool = coolRemaining("google-gemini") || coolRemaining("gemini");
  const text = [
    cool > 0 ? `⏳ Gemini limit (~**${cool}s**). Free catalog APIs se match nahi mila.` : `⏳ LLM unavailable.`,
    local.text,
    "Try: *What is X?*, *define Y*, *translate …*, *USD to INR*, *joke*, or add **Groq** key.",
  ].filter(Boolean).join("\n\n");

  return {
    mode: "local",
    provider: "local",
    text,
    toolTrace: local.toolTrace || [],
    orderPayload: local.orderPayload,
    tried,
    soft: false,
    fnCalls: [],
    sources: [],
  };
}

function updateProviderPill() {
  const sub = $("chatSub");
  if (!sub) return;
  const p = CHAT_CASCADE.find((x) => x.id === state.activeProvider);
  const name = p?.label || (state.activeProvider === "local" ? "Local tools" : state.activeProvider) || "Gemini";
  const auto = state.prefs.autoFailover !== false ? " · catalog switch" : "";
  const n = CHAT_CASCADE.length;
  sub.textContent = name + " · public-apis (" + n + ")" + auto;
}

/* ---------------- public-apis AI catalog ---------------- */
async function loadAiCatalog() {
  if (state.aiCatalog.loaded && state.aiCatalog.apis.length) return state.aiCatalog;
  try {
    const res = await fetch("./ai_apis.json", { cache: "no-cache" });
    if (!res.ok) throw new Error("ai_apis.json " + res.status);
    const data = await res.json();
    state.aiCatalog = {
      apis: data.apis || [],
      count: data.count || (data.apis || []).length,
      source: data.source || "https://github.com/public-apis/public-apis",
      failoverChain: data.failover?.chain || [],
      loaded: true,
    };
    rebuildChatCascadeFromCatalog();
  } catch (e) {
    console.warn("AI catalog load failed", e);
    state.aiCatalog = { apis: [], count: 0, source: "", loaded: true, error: e.message };
    rebuildChatCascadeFromCatalog();
  }
  return state.aiCatalog;
}
/** Build auto-switch list strictly from public-apis catalog rows (failover flag + runtime). */
function rebuildChatCascadeFromCatalog() {
  const apis = state.aiCatalog.apis || [];
  const rows = apis
    .filter((a) => a.failover && CATALOG_CHAT_RUNTIME[a.id])
    .sort((a, b) => (a.failoverOrder || 99) - (b.failoverOrder || 99));
  CHAT_CASCADE = rows.map((a) => {
    const rt = CATALOG_CHAT_RUNTIME[a.id];
    return {
      id: a.id, // catalog id e.g. google-gemini, groq
      catalogId: a.id,
      name: a.name,
      label: rt.label || a.name,
      url: a.url,
      description: a.description,
      auth: a.auth,
      kind: rt.kind,
      keyField: rt.keyField || a.keyField || null,
      model: rt.model,
      endpoint: rt.url,
      coolMs: rt.coolMs || COOL_MS_DEFAULT,
      source: "public-apis",
    };
  });
  // If catalog missing failover flags, still allow runtime keys that exist in catalog by id
  if (!CHAT_CASCADE.length) {
    for (const id of Object.keys(CATALOG_CHAT_RUNTIME)) {
      const a = apis.find((x) => x.id === id) || { id, name: CATALOG_CHAT_RUNTIME[id].label };
      if (!apis.length || apis.some((x) => x.id === id)) {
        const rt = CATALOG_CHAT_RUNTIME[id];
        CHAT_CASCADE.push({
          id, catalogId: id, name: a.name || rt.label, label: rt.label,
          url: a.url, kind: rt.kind, keyField: rt.keyField, model: rt.model,
          endpoint: rt.url, coolMs: rt.coolMs || COOL_MS_DEFAULT, source: "public-apis",
        });
      }
    }
  }
  return CHAT_CASCADE;
}
function findAiApi(idOrName) {
  const q = normalize(idOrName || "");
  if (!q) return null;
  const apis = state.aiCatalog.apis || [];
  return (
    apis.find((a) => a.id === idOrName) ||
    apis.find((a) => normalize(a.id) === q) ||
    apis.find((a) => normalize(a.name) === q) ||
    apis.find((a) => normalize(a.name).includes(q) || q.includes(normalize(a.name))) ||
    null
  );
}
async function callPublicAiApi(apiId, action, payload = {}) {
  await loadAiCatalog();
  const api = findAiApi(apiId);
  if (!api) return { error: "Unknown API id/name. Use list_ai_apis first.", hint: apiId };
  if (!api.callable) {
    return {
      error: "This API is catalog-only in-browser (OAuth/CORS/paid). Open docs and use externally.",
      name: api.name,
      url: api.url,
      auth: api.auth,
    };
  }
  const text = String(payload.text || payload.prompt || payload.query || "").trim();
  const kind = api.kind || action || "catalog";
  const act = (action || kind || "").toLowerCase();

  try {
    // Groq chat completions
    if (api.id === "groq" || act === "chat" && api.id === "groq") {
      const key = aiKey("groq");
      if (!key) return { error: "Add Groq API key in Settings → Extra AI keys", docs: api.url };
      const model = payload.model || "llama-3.1-8b-instant";
      const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: text || "Hello" }],
          temperature: 0.7,
          max_tokens: 1024,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { error: data?.error?.message || res.statusText, status: res.status };
      return { provider: "groq", model, text: data.choices?.[0]?.message?.content || "", usage: data.usage };
    }

    // Hugging Face router / inference
    if (api.id === "hugging-face") {
      const key = aiKey("huggingface");
      if (!key) return { error: "Add Hugging Face token in Settings", docs: api.url };
      const model = payload.model || "HuggingFaceH4/zephyr-7b-beta";
      const res = await fetch(`https://api-inference.huggingface.co/models/${encodeURIComponent(model)}`, {
        method: "POST",
        headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
        body: JSON.stringify({ inputs: text || "Hello", parameters: { max_new_tokens: 256 } }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { error: data?.error || res.statusText, status: res.status, raw: data };
      const out = Array.isArray(data) ? data[0]?.generated_text || JSON.stringify(data) : data.generated_text || JSON.stringify(data);
      return { provider: "huggingface", model, text: out };
    }

    // DeepAI text generation
    if (api.id === "deepai") {
      const key = aiKey("deepai");
      if (!key) return { error: "Add DeepAI key in Settings", docs: api.url };
      const body = new FormData();
      body.append("text", text || "Hello");
      const res = await fetch("https://api.deepai.org/api/text-generator", {
        method: "POST",
        headers: { "api-key": key },
        body,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { error: data?.err || data?.error || res.statusText, status: res.status };
      return { provider: "deepai", text: data.output || data };
    }

    // Jina Reader
    if (api.id === "jina-ai") {
      const key = aiKey("jina");
      const target = payload.url || text;
      if (!target) return { error: "Provide url or text for Jina" };
      if (/^https?:\/\//i.test(target)) {
        const headers = { Accept: "application/json" };
        if (key) headers.Authorization = "Bearer " + key;
        const res = await fetch("https://r.jina.ai/" + target, { headers });
        const t = await res.text();
        if (!res.ok) return { error: t.slice(0, 500), status: res.status };
        return { provider: "jina", kind: "reader", content: truncate(t, 12000) };
      }
      // embeddings if key
      if (!key) return { error: "Jina key needed for embeddings; or pass a URL for reader", docs: api.url };
      const res = await fetch("https://api.jina.ai/v1/embeddings", {
        method: "POST",
        headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
        body: JSON.stringify({ model: payload.model || "jina-embeddings-v3", input: [target] }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { error: data?.error || res.statusText, status: res.status };
      const emb = data.data?.[0]?.embedding;
      return { provider: "jina", kind: "embeddings", dims: emb?.length, sample: emb?.slice?.(0, 8) };
    }

    // LibreTranslate (no key)
    if (api.id === "libretranslate") {
      const res = await fetch("https://libretranslate.com/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          q: text || "Hello",
          source: payload.source || "auto",
          target: payload.target || payload.to || "en",
          format: "text",
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { error: data?.error || res.statusText, status: res.status, note: "Public instance may rate-limit or block CORS" };
      return { provider: "libretranslate", translated: data.translatedText, raw: data };
    }

    // Detect Language
    if (api.id === "detect-language") {
      const key = aiKey("detectlanguage");
      if (!key) return { error: "Add Detect Language key", docs: api.url };
      const res = await fetch("https://ws.detectlanguage.com/0.2/detect", {
        method: "POST",
        headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
        body: JSON.stringify({ q: text || "hello" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { error: data?.error || res.statusText, status: res.status };
      return { provider: "detectlanguage", data };
    }

    // Wolfram short answers
    if (api.id === "wolframalpha") {
      const key = aiKey("wolfram");
      if (!key) return { error: "Add Wolfram AppID in Settings", docs: api.url };
      const q = encodeURIComponent(text || "pi");
      const res = await fetch(`https://api.wolframalpha.com/v1/result?i=${q}&appid=${encodeURIComponent(key)}`);
      const t = await res.text();
      if (!res.ok) return { error: t || res.statusText, status: res.status };
      return { provider: "wolfram", answer: t };
    }

    // Perspective toxicity
    if (api.id === "perspective") {
      const key = aiKey("perspective");
      if (!key) return { error: "Add Perspective API key", docs: api.url };
      const res = await fetch(
        `https://commentanalyzer.googleapis.com/v1alpha1/comments:analyze?key=${encodeURIComponent(key)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            comment: { text: text || "test" },
            languages: ["en"],
            requestedAttributes: { TOXICITY: {}, INSULT: {}, THREAT: {} },
          }),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { error: data?.error?.message || res.statusText, status: res.status };
      const scores = {};
      for (const [k, v] of Object.entries(data.attributeScores || {})) scores[k] = v.summaryScore?.value;
      return { provider: "perspective", scores };
    }

    // NLP Cloud sentiment
    if (api.id === "nlp-cloud") {
      const key = aiKey("nlpcloud");
      if (!key) return { error: "Add NLP Cloud key", docs: api.url };
      const res = await fetch("https://api.nlpcloud.io/v1/en/distilbert-base-uncased-finetuned-sst-2-english/sentiment", {
        method: "POST",
        headers: { Authorization: "Token " + key, "Content-Type": "application/json" },
        body: JSON.stringify({ text: text || "I love this" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { error: data?.detail || data?.error || res.statusText, status: res.status };
      return { provider: "nlpcloud", data };
    }

    // Cloudmersive image/nlp — nlp language detect as text demo
    if (api.id === "cloudmersive") {
      const key = aiKey("cloudmersive");
      if (!key) return { error: "Add Cloudmersive key", docs: api.url };
      const res = await fetch("https://api.cloudmersive.com/nlp-v2/language/detect", {
        method: "POST",
        headers: { Apikey: key, "Content-Type": "application/json" },
        body: JSON.stringify({ TextToDetect: text || "hello world" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { error: data?.Message || res.statusText, status: res.status };
      return { provider: "cloudmersive", data };
    }

    // Hirak translation
    if (api.id === "hirak-translation") {
      const key = aiKey("hirak");
      const q = encodeURIComponent(text || "hello");
      const to = encodeURIComponent(payload.target || "hi");
      const url = `https://translate.hirak.site/translate?text=${q}&to=${to}` + (key ? `&key=${encodeURIComponent(key)}` : "");
      const res = await fetch(url);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { error: data?.message || res.statusText, status: res.status };
      return { provider: "hirak-translate", data };
    }

    // Kiprio translate
    if (api.id === "kiprio-translate") {
      const key = aiKey("kiprio");
      if (!key) return { error: "Add Kiprio key", docs: api.url };
      const res = await fetch("https://kiprio.com/v1/translate", {
        method: "POST",
        headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
        body: JSON.stringify({ text: text || "hello", target: payload.target || "hi" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { error: data?.error || res.statusText, status: res.status };
      return { provider: "kiprio", data };
    }

    // GoldBean
    if (api.id === "goldbean") {
      const key = aiKey("goldbean");
      if (!key) return { error: "Add GoldBean key", docs: api.url };
      const res = await fetch("https://goldbean-api.xyz/v1/chat", {
        method: "POST",
        headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
        body: JSON.stringify({ message: text || "hi" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { error: data?.error || res.statusText, status: res.status, note: "Endpoint shape may vary — see docs" };
      return { provider: "goldbean", data };
    }

    // Free meta / no-key endpoints
    if (api.id === "statlyte") {
      const res = await fetch("https://statlyte.com/api");
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { error: res.statusText, status: res.status, note: "CORS may block" };
      return { provider: "statlyte", data: typeof data === "object" ? truncate(JSON.stringify(data), 8000) : data };
    }
    if (api.id === "tensorfeed") {
      const res = await fetch("https://tensorfeed.ai/developers");
      const t = await res.text();
      return { provider: "tensorfeed", note: "Docs page", content: truncate(t.replace(/<[^>]+>/g, " "), 4000), url: api.url };
    }
    if (api.id === "ai-economics-tools") {
      const res = await fetch("https://piszczek.pl/tools/api");
      const data = await res.json().catch(async () => ({ text: await res.text() }));
      return { provider: "ai-economics", data: truncate(JSON.stringify(data), 6000), url: api.url };
    }
    if (api.id === "not-human-search") {
      const q = encodeURIComponent(text || "llm");
      const res = await fetch(`https://nothumansearch.ai/openapi.yaml`);
      const t = await res.text();
      return { provider: "nothumansearch", openapi_preview: truncate(t, 4000), query: text, url: api.url };
    }
    if (api.id === "dreamthreads") {
      const res = await fetch("https://mydreamthreads.xyz/dream-interpretation-api");
      const t = await res.text();
      return { provider: "dreamthreads", content: truncate(t.replace(/<[^>]+>/g, " "), 4000), url: api.url, note: "See docs for POST schema" };
    }
    if (api.id === "openvisionapi") {
      return { provider: "openvisionapi", url: api.url, note: "Requires image upload — use docs; browser CORS limited" };
    }
    if (api.id === "google-gemini") {
      return { provider: "gemini", note: "Primary chat already uses Gemini key in Settings", model: state.model };
    }

    // Free catalog helpers via tool
    const freeIds = {
      wikipedia: "wikipedia", "free-dictionary": "dictionary", datamuse: "words",
      "libretranslate": "translate", "jina-reader-free": "jina", "jina-ai": "jina",
      "exchange-rate-api": "fx", "open-trivia": "trivia", "advice-slip": "advice",
      jokeapi: "joke", "useless-facts": "fact", "zen-quotes": "quote", "bored-api": "bored",
      "rest-countries": "country",
    };
    if (freeIds[api.id] || api.freeChat) {
      const intentType = freeIds[api.id] || api.kind || "wikipedia";
      let intent = { type: intentType === "dictionary" ? "dictionary" : intentType, text, query: text, topic: text, word: (text || "hello").split(/\s+/)[0], name: text, url: payload.url || text, target: payload.target || "hi" };
      if (intentType === "reader" || api.id.includes("jina")) intent = { type: "jina", url: payload.url || text };
      if (intentType === "translate") intent = { type: "translate", text: text || "hello", target: payload.target || "hi" };
      if (intentType === "knowledge" || intentType === "wikipedia") intent = { type: "wikipedia", topic: text || "India" };
      const r = await callFreeCatalogApi(intent);
      return r.ok ? r : { error: r.error || "free api failed", provider: api.id };
    }

    return {
      error: "No in-browser handler for this API yet",
      name: api.name,
      url: api.url,
      kind: api.kind,
      auth: api.auth,
    };
  } catch (e) {
    return { error: e.message || String(e), note: "Often CORS or network — try docs / server proxy" };
  }
}
function getActive() {
  return state.chats.find((c) => c.id === state.activeId) || null;
}
function createChat() {
  const c = { id: uid(), title: "New chat", created: Date.now(), updated: Date.now(), messages: [] };
  state.chats.unshift(c);
  state.activeId = c.id;
  saveChats();
  return c;
}

/* ---------------- tools definitions (Gemini function calling) ---------------- */
function toolDeclarations() {
  const tools = [];
  const fns = [];

  if (state.prefs.orders) {
    fns.push(
      {
        name: "match_master",
        description: "Fuzzy-match a PO product name to material code from local master catalog. Never invent codes outside results.",
        parameters: {
          type: "OBJECT",
          properties: {
            po_name: { type: "STRING", description: "Product name as on PO" },
            pack: { type: "STRING", description: "Pack/size if any" },
          },
          required: ["po_name"],
        },
      },
      {
        name: "match_order_lines",
        description: "Match many PO lines at once. Input array of {po_name, pack, qty}. Returns matched table rows.",
        parameters: {
          type: "OBJECT",
          properties: {
            lines: {
              type: "ARRAY",
              items: {
                type: "OBJECT",
                properties: {
                  po_name: { type: "STRING" },
                  pack: { type: "STRING" },
                  qty: { type: "NUMBER" },
                },
              },
            },
          },
          required: ["lines"],
        },
      },
      {
        name: "search_master",
        description: "Search master product catalog by keyword or code",
        parameters: {
          type: "OBJECT",
          properties: { query: { type: "STRING" }, limit: { type: "NUMBER" } },
          required: ["query"],
        },
      },
      {
        name: "save_alias_rule",
        description: "Save distributor product name → material code mapping for future matches",
        parameters: {
          type: "OBJECT",
          properties: {
            pattern: { type: "STRING" },
            code: { type: "STRING" },
            pack: { type: "STRING" },
            note: { type: "STRING" },
          },
          required: ["pattern", "code"],
        },
      },
      {
        name: "list_master_stats",
        description: "Return counts of master products and saved rules",
        parameters: { type: "OBJECT", properties: {} },
      }
    );
  }

  fns.push(
    {
      name: "memory_add",
      description: "Save a lasting fact about the user or business to memory",
      parameters: {
        type: "OBJECT",
        properties: { fact: { type: "STRING" } },
        required: ["fact"],
      },
    },
    {
      name: "memory_list",
      description: "List saved memory facts",
      parameters: { type: "OBJECT", properties: {} },
    },
    {
      name: "memory_delete",
      description: "Delete memory by index (0-based) or exact text",
      parameters: {
        type: "OBJECT",
        properties: { index: { type: "NUMBER" }, text: { type: "STRING" } },
      },
    },
    {
      name: "fetch_url",
      description: "Fetch text content from a public http(s) URL (CORS permitting)",
      parameters: {
        type: "OBJECT",
        properties: { url: { type: "STRING" } },
        required: ["url"],
      },
    },
    {
      name: "get_datetime",
      description: "Get current date/time in Asia/Kolkata",
      parameters: { type: "OBJECT", properties: {} },
    }
  );

  if (state.prefs.aiApis !== false) {
    fns.push(
      {
        name: "list_ai_apis",
        description:
          "List AI APIs from the public-apis catalog (Machine Learning + Text Analysis). Filter by query/tag/category/callable.",
        parameters: {
          type: "OBJECT",
          properties: {
            query: { type: "STRING", description: "Search name/description" },
            tag: { type: "STRING", description: "llm|vision|audio|nlp|data|ai" },
            category: { type: "STRING" },
            callable_only: { type: "BOOLEAN" },
            limit: { type: "NUMBER" },
          },
        },
      },
      {
        name: "get_ai_api",
        description: "Get details for one AI API by id or name from the catalog",
        parameters: {
          type: "OBJECT",
          properties: { id_or_name: { type: "STRING" } },
          required: ["id_or_name"],
        },
      },
      {
        name: "call_ai_api",
        description:
          "Call a callable AI provider from the catalog (Groq, HuggingFace, DeepAI, Jina, LibreTranslate, Wolfram, Perspective, etc.). Requires user key in Settings when auth needed.",
        parameters: {
          type: "OBJECT",
          properties: {
            api_id: { type: "STRING", description: "Catalog id e.g. groq, libretranslate, jina-ai" },
            action: { type: "STRING", description: "Optional action hint: chat, translate, embed, detect" },
            text: { type: "STRING" },
            url: { type: "STRING" },
            target: { type: "STRING", description: "Target language code for translate" },
            source: { type: "STRING" },
            model: { type: "STRING" },
          },
          required: ["api_id"],
        },
      }
    );
  }

  if (fns.length) tools.push({ functionDeclarations: fns });
  if (state.prefs.web) tools.push({ googleSearch: {} });
  return tools;
}

async function runTool(name, args) {
  args = args || {};
  switch (name) {
    case "match_master": {
      const m = matchProduct(args.po_name || "", args.pack || "");
      return { po_name: args.po_name, pack: args.pack || "", ...m };
    }
    case "match_order_lines": {
      const lines = Array.isArray(args.lines) ? args.lines : [];
      return {
        rows: lines.map((l) => {
          const m = matchProduct(l.po_name || "", l.pack || "");
          return {
            po_name: l.po_name,
            pack: l.pack || "",
            qty: l.qty ?? "",
            code: m.code,
            status: m.status,
            conf: m.conf,
            master_name: m.name,
          };
        }),
      };
    }
    case "search_master": {
      const q = normalize(args.query || "");
      const limit = Math.min(Number(args.limit) || 10, 20);
      const hits = [];
      for (const p of state.master) {
        let sc = tokenScore(q, p.name) * 50 + levSim(q, p.name) * 30;
        if (String(p.code).includes(String(args.query || "").trim())) sc += 40;
        if (normalize(p.name).includes(q)) sc += 20;
        if (/chandrika/.test(q) && /chk|chandrika/.test(normalize(p.name))) sc += 40;
        if (sc >= 25) hits.push({ code: p.code, name: p.name, score: Math.round(sc) });
      }
      hits.sort((a, b) => b.score - a.score);
      return { hits: hits.slice(0, limit), total_master: state.master.length };
    }
    case "save_alias_rule": {
      upsertRule(args.pattern, args.code, args.pack || "", args.note || "from chat");
      return { ok: true, rules: state.rules.length };
    }
    case "list_master_stats":
      return { master: state.master.length, rules: state.rules.length, memory: state.memory.length, chats: state.chats.length };
    case "memory_add": {
      const fact = String(args.fact || "").trim();
      if (!fact) return { ok: false };
      if (!state.memory.includes(fact)) state.memory.unshift(fact);
      saveMemory();
      return { ok: true, memory: state.memory };
    }
    case "memory_list":
      return { memory: state.memory };
    case "memory_delete": {
      if (typeof args.index === "number") state.memory.splice(args.index, 1);
      else if (args.text) state.memory = state.memory.filter((m) => m !== args.text);
      saveMemory();
      return { ok: true, memory: state.memory };
    }
    case "fetch_url": {
      try {
        const u = String(args.url || "");
        if (!/^https?:\/\//i.test(u)) return { error: "Only http(s) URLs" };
        const res = await fetch(u);
        const text = await res.text();
        return { status: res.status, content: truncate(text.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " "), 12000) };
      } catch (e) {
        return { error: e.message || "fetch failed (CORS?)" };
      }
    }
    case "get_datetime": {
      const d = new Date();
      return {
        iso: d.toISOString(),
        local: d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }),
        timezone: "Asia/Kolkata",
      };
    }
    case "list_ai_apis": {
      await loadAiCatalog();
      const q = normalize(args.query || "");
      const tag = normalize(args.tag || "");
      const cat = normalize(args.category || "");
      const only = !!args.callable_only;
      const limit = Math.min(Number(args.limit) || 25, 62);
      let list = state.aiCatalog.apis || [];
      if (q) list = list.filter((a) => normalize(a.name + " " + a.description + " " + a.id).includes(q));
      if (tag) list = list.filter((a) => (a.tags || []).map(normalize).includes(tag));
      if (cat) list = list.filter((a) => normalize(a.category).includes(cat));
      if (only) list = list.filter((a) => a.callable);
      return {
        source: state.aiCatalog.source,
        total: state.aiCatalog.count,
        matched: list.length,
        apis: list.slice(0, limit).map((a) => ({
          id: a.id,
          name: a.name,
          category: a.category,
          auth: a.auth,
          tags: a.tags,
          callable: !!a.callable,
          keyField: a.keyField || null,
          url: a.url,
          description: a.description,
        })),
      };
    }
    case "get_ai_api": {
      await loadAiCatalog();
      const a = findAiApi(args.id_or_name || args.id || args.name);
      if (!a) return { error: "Not found", query: args.id_or_name };
      return { ...a, has_key: a.keyField ? !!aiKey(a.keyField) : null };
    }
    case "call_ai_api": {
      return await callPublicAiApi(args.api_id || args.id || args.name, args.action, {
        text: args.text || args.prompt || args.query,
        url: args.url,
        target: args.target || args.to,
        source: args.source,
        model: args.model,
      });
    }
    default:
      return { error: "Unknown tool " + name };
  }
}

/* ---------------- Gemini API ---------------- */
async function geminiGenerate({ contents, tools, toolConfig }) {
  if (isProviderCool("google-gemini") || (state.apiCoolUntil && Date.now() < state.apiCoolUntil)) {
    const sec = coolRemaining("google-gemini") || Math.ceil((state.apiCoolUntil - Date.now()) / 1000);
    const e = new Error(`Gemini cooldown ${sec}s (free tier). Auto-switch will try backup APIs.`);
    e.code = 429;
    throw e;
  }
  let model = resolveModel(state.model);
  const url = (m) =>
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(m)}:generateContent?key=${encodeURIComponent(state.apiKey)}`;

  const body = {
    contents,
    tools: tools?.length ? tools : undefined,
    toolConfig,
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 8192,
    },
  };

  // thinking / include thought if supported — pass via generationConfig when checkbox on
  if (state.prefs.thinking) {
    body.generationConfig.thinkingConfig = { includeThoughts: true };
  }

  let res = await fetch(url(model), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  let data = await res.json().catch(() => ({}));

  // fallback models only on not-found, not on 429
  if (!res.ok && res.status !== 429 && (/not found|no longer available|not supported|Invalid JSON/i.test(data?.error?.message || "") || res.status === 404)) {
    // retry without thinkingConfig if that failed
    if (body.generationConfig.thinkingConfig) {
      delete body.generationConfig.thinkingConfig;
      res = await fetch(url(model), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      data = await res.json().catch(() => ({}));
    }
    if (!res.ok && res.status !== 429) {
      for (const fb of ["gemini-3.6-flash", "gemini-2.5-flash", "gemini-2.0-flash-lite"]) {
        if (fb === model) continue;
        res = await fetch(url(fb), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        data = await res.json().catch(() => ({}));
        if (res.status === 429) break;
        if (res.ok) {
          state.model = fb;
          localStorage.setItem(STORAGE.model, fb);
          break;
        }
      }
    }
  }

  if (!res.ok) {
    const msg = data?.error?.message || res.statusText;
    if (res.status === 429) {
      markProviderCool("google-gemini");
      const e = new Error("Gemini API limit (429). Switching to backup provider if keys available…");
      e.code = 429;
      throw e;
    }
    throw new Error(msg || "Gemini failed");
  }
  clearProviderCool("google-gemini");
  return data;
}

function extractParts(data) {
  const cand = data?.candidates?.[0];
  const parts = cand?.content?.parts || [];
  let text = "";
  let thinking = "";
  const fnCalls = [];
  for (const p of parts) {
    if (p.thought) thinking += (p.text || "") + "\n";
    else if (p.functionCall) fnCalls.push(p.functionCall);
    else if (p.text) text += p.text;
  }
  // grounding
  const gm = cand?.groundingMetadata;
  const sources = [];
  if (gm?.groundingChunks) {
    for (const ch of gm.groundingChunks) {
      const u = ch.web?.uri || ch.web?.url;
      const t = ch.web?.title;
      if (u) sources.push({ url: u, title: t || u });
    }
  }
  if (gm?.groundingSupports) {
    /* optional */
  }
  return { text, thinking: thinking.trim(), fnCalls, sources, raw: cand };
}

/* ---------------- files ---------------- */
function setupPdf() {
  if (window.pdfjsLib) {
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js";
  }
}
function guessMime(name = "") {
  const n = name.toLowerCase();
  if (n.endsWith(".pdf")) return "application/pdf";
  if (n.endsWith(".png")) return "image/png";
  if (n.endsWith(".jpg") || n.endsWith(".jpeg")) return "image/jpeg";
  if (n.endsWith(".webp")) return "image/webp";
  if (n.endsWith(".xlsx")) return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (n.endsWith(".csv") || n.endsWith(".txt")) return "text/plain";
  return "application/octet-stream";
}
async function toB64(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => {
      const s = String(r.result || "");
      res(s.slice(s.indexOf(",") + 1));
    };
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}
async function extractText(file) {
  const name = (file.name || "").toLowerCase();
  const mime = file.type || guessMime(file.name);
  if (mime.startsWith("text/") || name.endsWith(".txt") || name.endsWith(".csv") || name.endsWith(".json"))
    return file.text();
  if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
    if (!window.XLSX) return "";
    const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
    return wb.SheetNames.map((s) => XLSX.utils.sheet_to_csv(wb.Sheets[s])).join("\n");
  }
  if (mime === "application/pdf" || name.endsWith(".pdf")) {
    if (!window.pdfjsLib) return "";
    try {
      const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
      let t = "";
      for (let i = 1; i <= Math.min(pdf.numPages, 15); i++) {
        const p = await pdf.getPage(i);
        const c = await p.getTextContent();
        t += c.items.map((x) => x.str).join(" ") + "\n";
      }
      return t;
    } catch { return ""; }
  }
  return "";
}
async function filesToParts(files) {
  const parts = [];
  let textBlob = "";
  for (const f of files) {
    const mime = f.type || guessMime(f.name);
    if (mime.startsWith("image/") || ((mime === "application/pdf" || /\.pdf$/i.test(f.name)) && f.size < 12e6)) {
      parts.push({ inlineData: { mimeType: mime.startsWith("image/") ? mime : "application/pdf", data: await toB64(f) } });
    }
    try {
      const t = await extractText(f);
      if (t) textBlob += `\n--- ${f.name} ---\n${t}`;
    } catch (_) {}
  }
  return { parts, textBlob };
}

/* ---------------- UI render ---------------- */
function setStatus(t) {
  const p = $("statusPill");
  if (p) p.textContent = t;
}
function applyTheme(th) {
  state.theme = th === "light" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", state.theme);
  localStorage.setItem(STORAGE.theme, state.theme);
  $("btnTheme").textContent = state.theme === "dark" ? "◐" : "◑";
}
function renderChatList() {
  const q = normalize($("historySearch")?.value || "");
  const list = $("chatList");
  list.innerHTML = "";
  for (const c of state.chats) {
    if (q && !normalize(c.title).includes(q) && !c.messages.some((m) => normalize(m.text || "").includes(q)))
      continue;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "chat-item" + (c.id === state.activeId ? " active" : "");
    btn.innerHTML = `<span class="t">${escapeHtml(c.title || "Chat")}</span><span class="del" title="Delete">✕</span>`;
    btn.onclick = (e) => {
      if (e.target.closest(".del")) {
        e.stopPropagation();
        if (!confirm("Delete this chat?")) return;
        state.chats = state.chats.filter((x) => x.id !== c.id);
        if (state.activeId === c.id) {
          state.activeId = state.chats[0]?.id || null;
          if (!state.activeId) createChat();
        }
        saveChats();
        renderChatList();
        renderMessages();
        return;
      }
      state.activeId = c.id;
      renderChatList();
      renderMessages();
      closeSidebar();
    };
    list.appendChild(btn);
  }
}
function renderMessages() {
  const box = $("messages");
  const chat = getActive();
  $("chatTitle").textContent = chat?.title || "Mohan AI";
  if (!chat || !chat.messages.length) {
    box.innerHTML = `
      <div class="welcome-hero">
        <h2>Mohan AI</h2>
        <p>Gemini limit pe bhi chalega — <b>free catalog APIs</b> (Wikipedia, Dictionary, Translate, FX…).</p>
        <p class="sm">Master: <b>${state.master.length}</b> · Catalog: <b>${state.aiCatalog.count || "…"}</b> · Free APIs: <b>on</b></p>
        <p class="sm">LLM pool: <b>${listReadyProviders().map((p)=>p.label).join(" / ") || "none — free APIs still work"}</b></p>
        <div class="suggestions">
          <button type="button" data-s="What is photosynthesis?">Free: Wikipedia</button>
          <button type="button" data-s="define enzyme">Free: Dictionary</button>
          <button type="button" data-s="USD to INR">Free: FX rates</button>
          <button type="button" data-s="Match this order line: CHANDRIKA SOAP 75GM qty 192">Match order</button>
        </div>
      </div>`;
    box.querySelectorAll("[data-s]").forEach((b) => {
      b.onclick = () => {
        $("msgInput").value = b.dataset.s;
        sendMessage();
      };
    });
    return;
  }
  box.innerHTML = "";
  for (const m of chat.messages) box.appendChild(renderMsg(m));
  box.scrollTop = box.scrollHeight;
}
function renderMsg(m) {
  const wrap = document.createElement("div");
  wrap.className = "msg " + (m.role === "user" ? "user" : "bot");
  wrap.dataset.id = m.id;
  const av = m.role === "user" ? "You" : "M";
  let body = "";
  if (m.thinking && state.prefs.thinking) {
    body += `<details class="thinking" open><summary>💭 Thinking</summary><div class="thinking-body">${escapeHtml(m.thinking)}</div></details>`;
  }
  if (m.provider && m.provider !== "gemini" && m.provider !== "google-gemini" && !(m.soft || (m.provider === "local" && !m.tools?.length))) {
    body += `<div class="provider-badge">via ${escapeHtml(m.provider)}</div>`;
  }
  if (m.tools?.length) {
    body += `<div class="tool-trace">${m.tools.map((t) => escapeHtml(t)).join(" · ")}</div>`;
  }
  if (m.role === "user") {
    body += `<div class="md">${escapeHtml(m.text || "").replace(/\n/g, "<br>")}</div>`;
    if (m.files?.length) body += `<div class="sm" style="margin-top:6px;opacity:.85">📎 ${escapeHtml(m.files.join(", "))}</div>`;
  } else {
    body += `<div class="md">${markdown(m.text || "")}</div>`;
  }
  if (m.order?.rows?.length) body += renderOrderCard(m.order);
  if (m.sources?.length) {
    body += `<div class="sources"><b>Sources</b>${m.sources
      .slice(0, 6)
      .map((s) => `<a href="${escapeHtml(s.url)}" target="_blank" rel="noopener">${escapeHtml(s.title || s.url)}</a>`)
      .join("")}</div>`;
  }
  if (m.role === "model" || m.role === "bot" || m.role === "assistant") {
    body += `<div class="msg-actions">
      <button type="button" data-act="copy">Copy</button>
      <button type="button" data-act="retry">Retry</button>
    </div>`;
  }
  wrap.innerHTML = `<div class="msg-row"><div class="avatar">${av}</div><div class="bubble">${body}</div></div>`;
  wrap.querySelectorAll("[data-act]").forEach((btn) => {
    btn.onclick = async () => {
      if (btn.dataset.act === "copy") {
        await navigator.clipboard.writeText(m.text || "");
        setStatus("Copied");
      }
      if (btn.dataset.act === "retry") {
        // resend last user message
        const chat = getActive();
        const idx = chat.messages.findIndex((x) => x.id === m.id);
        let u = null;
        for (let i = idx - 1; i >= 0; i--) if (chat.messages[i].role === "user") { u = chat.messages[i]; break; }
        if (u) {
          chat.messages = chat.messages.slice(0, chat.messages.indexOf(u) + 1);
          // remove after user
          saveChats();
          await runAssistant();
        }
      }
    };
  });
  wrap.querySelectorAll("[data-copy-order]").forEach((btn) => {
    btn.onclick = async () => {
      const rows = m.order.rows;
      const tsv = "Code\tQty\tPO Name\tPack\tStatus\tConf\n" +
        rows.map((r) => `${r.code || ""}\t${r.qty ?? ""}\t${r.po_name || ""}\t${r.pack || ""}\t${r.status}\t${r.conf}`).join("\n");
      await navigator.clipboard.writeText(tsv);
      setStatus("Order TSV copied");
    };
  });
  return wrap;
}
function renderOrderCard(order) {
  const g = order.rows.filter((r) => r.status === "green").length;
  const y = order.rows.filter((r) => r.status === "yellow").length;
  const r = order.rows.filter((r) => r.status === "red").length;
  return `<div class="order-card">
    <div class="oc-head">
      <span class="grow">📦 Order match · 🟢${g} 🟡${y} 🔴${r}</span>
      <button type="button" class="btn sm primary" data-copy-order>Copy Excel</button>
    </div>
    <div class="order-scroll"><table>
      <thead><tr><th class="st"></th><th>Code</th><th>Qty</th><th>PO Name</th><th>Pack</th><th>Conf</th></tr></thead>
      <tbody>
        ${order.rows
          .map(
            (row) => `<tr>
          <td class="st"><i class="${row.status === "green" ? "g" : row.status === "yellow" ? "y" : "r"}"></i></td>
          <td><b>${escapeHtml(row.code || "—")}</b></td>
          <td>${escapeHtml(String(row.qty ?? ""))}</td>
          <td>${escapeHtml(row.po_name || "")}${row.master_name ? `<div class="sm muted">→ ${escapeHtml(row.master_name)}</div>` : ""}</td>
          <td>${escapeHtml(row.pack || "")}</td>
          <td class="conf">${row.conf ?? 0}%</td>
        </tr>`
          )
          .join("")}
      </tbody>
    </table></div>
  </div>`;
}
function renderAttach() {
  const el = $("attachPreview");
  if (!state.pendingFiles.length) {
    el.classList.add("hidden");
    el.innerHTML = "";
    return;
  }
  el.classList.remove("hidden");
  el.innerHTML = state.pendingFiles
    .map((f, i) => `<span class="attach-chip">${escapeHtml(f.name)} <button type="button" data-i="${i}">✕</button></span>`)
    .join("");
  el.querySelectorAll("button").forEach((b) => {
    b.onclick = () => {
      state.pendingFiles.splice(+b.dataset.i, 1);
      renderAttach();
    };
  });
}
function addTyping() {
  const wrap = document.createElement("div");
  wrap.className = "msg bot";
  wrap.id = "typingEl";
  wrap.innerHTML = `<div class="msg-row"><div class="avatar">M</div><div class="bubble"><span class="typing-dots"><i></i><i></i><i></i></span></div></div>`;
  $("messages").appendChild(wrap);
  $("messages").scrollTop = $("messages").scrollHeight;
}
function removeTyping() {
  $("typingEl")?.remove();
}

/* ---------------- send / agent loop ---------------- */
async function sendMessage() {
  if (state.busy) return;
  const text = $("msgInput").value.trim();
  const files = [...state.pendingFiles];
  if (!text && !files.length) return;
  if (!CHAT_CASCADE.length) await loadAiCatalog();
  // Free catalog APIs work with zero keys — only nudge settings if user wants LLM
  const hasAnyKey = listReadyProviders().length > 0 || !!state.apiKey || CHAT_CASCADE.some(providerKeyOk);
  if (!hasAnyKey) {
    // allow send; free path will answer
    setStatus("Free APIs mode (no LLM keys)");
  }

  let chat = getActive();
  if (!chat) chat = createChat();

  // clear welcome
  if (!chat.messages.length) $("messages").innerHTML = "";

  const userMsg = {
    id: uid(),
    role: "user",
    text: text || (files.length ? "(attachment)" : ""),
    files: files.map((f) => f.name),
    ts: Date.now(),
  };
  chat.messages.push(userMsg);
  chat.updated = Date.now();
  if (chat.title === "New chat") chat.title = nowTitle(chat.messages);
  $("msgInput").value = "";
  $("msgInput").style.height = "auto";
  state.pendingFiles = [];
  renderAttach();
  saveChats();
  renderChatList();
  $("messages").appendChild(renderMsg(userMsg));
  $("messages").scrollTop = $("messages").scrollHeight;

  // stash files on chat for this turn
  chat._turnFiles = files;
  await runAssistant();
}

async function runAssistant() {
  const chat = getActive();
  if (!chat) return;
  state.busy = true;
  $("btnSend").disabled = true;
  setStatus("Thinking…");
  addTyping();

  try {
    const files = chat._turnFiles || [];
    chat._turnFiles = [];
    const { parts: fileParts, textBlob } = await filesToParts(files);

    // Build contents from history
    const contents = [];
    // system as user preamble (API style)
    const memBlock =
      state.prefs.memory && state.memory.length
        ? "\n\nMEMORY (user facts):\n- " + state.memory.slice(0, 30).join("\n- ")
        : "";
    const sys =
      BASE_SYSTEM +
      (state.systemExtra ? "\n\nExtra instructions:\n" + state.systemExtra : "") +
      memBlock +
      `\n\nLocal catalog: ${state.master.length} products, ${state.rules.length} alias rules.`;

    // First message includes system
    const hist = chat.messages.filter((m) => m.role === "user" || m.role === "model" || m.role === "assistant");
    // convert to gemini: model role = model
    for (let i = 0; i < hist.length; i++) {
      const m = hist[i];
      const role = m.role === "user" ? "user" : "model";
      let t = m.text || "";
      if (i === 0 && role === "user") t = sys + "\n\n---\nUser:\n" + t;
      if (i === hist.length - 1 && role === "user" && textBlob)
        t += "\n\nAttached file text extract:\n" + truncate(textBlob, 80000);
      const parts = [{ text: t }];
      if (i === hist.length - 1 && role === "user") {
        for (const p of fileParts) parts.push(p);
      }
      // skip empty model
      if (role === "model" && !t.trim()) continue;
      contents.push({ role, parts });
    }

    const tools = toolDeclarations();
    const lastUser = [...hist].reverse().find((m) => m.role === "user");
    const userText = lastUser?.text || "";

    let text = "";
    let thinking = "";
    let sources = [];
    let toolTrace = [];
    let orderPayload = null;
    let usedProvider = "gemini";

    const first = await generateWithFailover({
      contents,
      tools,
      userText,
      fileText: textBlob,
    });

    if (first.mode === "free") {
      usedProvider = first.provider || "free-catalog";
      text = first.text || "";
      toolTrace = first.toolTrace || [];
      orderPayload = first.orderPayload || null;
    } else if (first.mode === "gemini") {
      let data = first.data;
      usedProvider = "gemini";
      let extracted = extractParts(data);
      text = extracted.text;
      thinking = extracted.thinking;
      let fnCalls = extracted.fnCalls;
      sources = extracted.sources || [];

      // Agentic tool loop (max 6) — Gemini only
      let loops = 0;
      while (fnCalls.length && loops < 6) {
        loops++;
        setStatus(`Tool: ${fnCalls.map((f) => f.name).join(", ")}…`);
        const modelParts = [];
        for (const fc of fnCalls) {
          modelParts.push({ functionCall: fc });
          toolTrace.push(fc.name);
        }
        contents.push({ role: "model", parts: modelParts });

        const frParts = [];
        for (const fc of fnCalls) {
          let args = fc.args || {};
          if (typeof args === "string") try { args = JSON.parse(args); } catch { args = {}; }
          const result = await runTool(fc.name, args);
          if (fc.name === "match_order_lines" && result.rows) orderPayload = { rows: result.rows };
          if (fc.name === "match_master" && result.code !== undefined) {
            orderPayload = {
              rows: [
                {
                  po_name: result.po_name,
                  pack: result.pack,
                  qty: "",
                  code: result.code,
                  status: result.status,
                  conf: result.conf,
                  master_name: result.name,
                },
              ],
            };
          }
          frParts.push({
            functionResponse: {
              name: fc.name,
              response: result,
            },
          });
        }
        contents.push({ role: "user", parts: frParts });

        try {
          data = await geminiGenerate({ contents, tools });
        } catch (err) {
          if (err.code === 429 && state.prefs.autoFailover !== false) {
            // Mid-tool-loop limit → finish with failover plain answer
            const fb = await generateWithFailover({ contents, tools: [], userText, fileText: textBlob });
            usedProvider = fb.provider;
            text = fb.text || text;
            if (fb.orderPayload) orderPayload = fb.orderPayload;
            if (fb.toolTrace?.length) toolTrace = toolTrace.concat(fb.toolTrace);
            toolTrace.push("auto_failover:" + fb.provider);
            fnCalls = [];
            break;
          }
          throw err;
        }
        const ex = extractParts(data);
        text = ex.text;
        if (ex.thinking) thinking = (thinking ? thinking + "\n" : "") + ex.thinking;
        if (ex.sources?.length) sources = [...(sources || []), ...ex.sources];
        fnCalls = ex.fnCalls;
      }
    } else {
      // fallback / local path
      usedProvider = first.provider;
      text = first.text || "";
      thinking = first.thinking || "";
      sources = first.sources || [];
      toolTrace = first.toolTrace || [];
      orderPayload = first.orderPayload || null;
      if (!first.soft && usedProvider && usedProvider !== "gemini") {
        toolTrace = ["auto_failover:" + usedProvider].concat(toolTrace);
      }
    }

    removeTyping();
    const botMsg = {
      id: uid(),
      role: "model",
      text: text || (orderPayload ? "Order match complete." : "(empty response)"),
      thinking: thinking || undefined,
      tools: toolTrace.length ? toolTrace : undefined,
      sources: sources?.length ? sources : undefined,
      order: orderPayload || undefined,
      provider: usedProvider,
      soft: first?.soft || undefined,
      ts: Date.now(),
    };
    chat.messages.push(botMsg);
    chat.updated = Date.now();
    saveChats();
    renderChatList();
    $("messages").appendChild(renderMsg(botMsg));
    $("messages").scrollTop = $("messages").scrollHeight;
    updateProviderPill();
    const readyBits = listReadyProviders().map((p) => p.label).join("/");
    if (first?.soft) setStatus(coolStatusHint());
    else setStatus(usedProvider === "gemini" || usedProvider === "google-gemini" ? "Ready · Gemini" : `Ready · ${usedProvider}` + (readyBits ? ` · ${readyBits}` : ""));
  } catch (err) {
    console.error(err);
    removeTyping();
    // Last-ditch local if rate limit
    if (err.code === 429 || /429|rate limit|cooldown/i.test(err.message || "")) {
      try {
        const chat2 = getActive();
        const lastU = [...(chat2?.messages || [])].reverse().find((m) => m.role === "user");
        const local = await runLocalAgentPass(lastU?.text || "", "", { fromFailover: true });
        const botMsg = {
          id: uid(),
          role: "model",
          text: local.text || err.message,
          tools: local.soft ? undefined : (local.toolTrace?.length ? local.toolTrace : undefined),
          order: local.orderPayload || undefined,
          provider: "local",
          soft: local.soft || undefined,
          ts: Date.now(),
        };
        chat2?.messages.push(botMsg);
        saveChats();
        $("messages").appendChild(renderMsg(botMsg));
        state.activeProvider = "local";
        updateProviderPill();
        setStatus("Limited · local tools");
        return;
      } catch (_) {}
    }
    const botMsg = {
      id: uid(),
      role: "model",
      text: "⚠️ **Error:** " + (err.message || String(err)),
      ts: Date.now(),
    };
    getActive()?.messages.push(botMsg);
    saveChats();
    $("messages").appendChild(renderMsg(botMsg));
    setStatus("Error");
  } finally {
    state.busy = false;
    $("btnSend").disabled = false;
  }
}

/* ---------------- modals ---------------- */
function renderAiKeysGrid() {
  const grid = $("aiKeysGrid");
  if (!grid) return;
  grid.innerHTML = AI_KEY_FIELDS.map((f) => {
    const val = escapeHtml(state.aiKeys?.[f.id] || "");
    return `<div class="ai-key-row">
      <label for="aik_${f.id}">${escapeHtml(f.label)} <small>(${escapeHtml(f.hint)})</small></label>
      <input type="password" class="input" id="aik_${f.id}" data-aik="${f.id}" value="${val}" placeholder="optional key" autocomplete="off" />
    </div>`;
  }).join("");
}
function collectAiKeysFromForm() {
  const out = { ...state.aiKeys };
  document.querySelectorAll("[data-aik]").forEach((inp) => {
    out[inp.dataset.aik] = inp.value.trim();
  });
  state.aiKeys = out;
  saveAiKeys();
}
function openSettings() {
  $("apiKeyInput").value = state.apiKey;
  $("modelSelect").value = state.model;
  $("systemPrompt").value = state.systemExtra;
  $("masterStatus").textContent = `${state.master.length} products · ${state.rules.length} rules`;
  renderAiKeysGrid();
  if ($("chkAutoFailover")) $("chkAutoFailover").checked = state.prefs.autoFailover !== false;
  const pool = $("failoverPoolStatus");
  if (pool) {
    if (!CHAT_CASCADE.length) rebuildChatCascadeFromCatalog();
    const rows = CHAT_CASCADE.map((p) => {
      const ready = providerReady(p);
      const cool = isProviderCool(p.id) ? `cool ${coolRemaining(p.id)}s` : "";
      const keyOk = providerKeyOk(p);
      const key = keyOk ? "key✓" : "no key";
      return `${p.label} [${p.catalogId || p.id}]: ${ready ? "READY" : "wait"} ${key} ${cool}`.trim();
    });
    pool.textContent = (rows.join(" · ") || "Catalog not loaded") + " · source: public-apis";
  }
  $("settingsModal").classList.remove("hidden");
}
function openAiApis() {
  loadAiCatalog().then(() => {
    const cats = [...new Set((state.aiCatalog.apis || []).map((a) => a.category))].sort();
    const sel = $("aiApiCat");
    if (sel && sel.options.length <= 1) {
      cats.forEach((c) => {
        const o = document.createElement("option");
        o.value = c;
        o.textContent = c;
        sel.appendChild(o);
      });
    }
    renderAiApiList();
    $("aiApisModal").classList.remove("hidden");
  });
}
function renderAiApiList() {
  const q = normalize($("aiApiSearch")?.value || "");
  const cat = $("aiApiCat")?.value || "";
  const tag = $("aiApiTag")?.value || "";
  const only = !!$("aiApiCallableOnly")?.checked;
  let list = state.aiCatalog.apis || [];
  if (q) list = list.filter((a) => normalize(a.name + " " + a.description + " " + (a.tags || []).join(" ")).includes(q));
  if (cat) list = list.filter((a) => a.category === cat);
  if (tag) list = list.filter((a) => (a.tags || []).includes(tag));
  if (only) list = list.filter((a) => a.callable);
  $("aiApiCount").textContent = `${list.length} / ${state.aiCatalog.count || 0} APIs · source public-apis`;
  const box = $("aiApiList");
  box.innerHTML = list
    .map((a) => {
      const tags = (a.tags || []).map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join("");
      const authTag =
        a.auth === "No"
          ? `<span class="tag free">No auth</span>`
          : `<span class="tag auth">${escapeHtml(a.auth)}</span>`;
      const callTag = a.callable ? `<span class="tag call">Callable</span>` : "";
      const failTag = a.failover ? `<span class="tag call">Auto-switch</span>` : "";
      const hasKey = a.keyField === "gemini" ? !!state.apiKey : (a.keyField && aiKey(a.keyField));
      return `<div class="ai-api-card" data-id="${escapeHtml(a.id)}">
        <h3>${escapeHtml(a.name)}</h3>
        <p class="desc">${escapeHtml(a.description)}</p>
        <div class="meta">${authTag}${callTag}${failTag}${tags}<span class="tag">${escapeHtml(a.category)}</span></div>
        <div class="actions">
          <a class="btn sm ghost" href="${escapeHtml(a.url)}" target="_blank" rel="noopener">Docs</a>
          ${
            a.callable
              ? `<button type="button" class="btn sm primary" data-try="${escapeHtml(a.id)}">${hasKey || a.auth === "No" ? "Try in chat" : "Add key"}</button>`
              : `<button type="button" class="btn sm" data-try="${escapeHtml(a.id)}">Ask about</button>`
          }
        </div>
      </div>`;
    })
    .join("");
  box.querySelectorAll("[data-try]").forEach((btn) => {
    btn.onclick = () => {
      const id = btn.dataset.try;
      const a = findAiApi(id);
      $("aiApisModal").classList.add("hidden");
      if (a?.callable && a.keyField && !aiKey(a.keyField) && a.auth !== "No") {
        openSettings();
        setStatus("Add " + (a.keyField) + " key");
        return;
      }
      if (a?.callable) {
        $("msgInput").value = `Call AI API "${a.name}" (id: ${a.id}): `;
      } else {
        $("msgInput").value = `Tell me about the AI API "${a?.name || id}" from the catalog and how to use it.`;
      }
      $("msgInput").focus();
    };
  });
}
function openMemory() {
  renderMemoryList();
  $("memoryModal").classList.remove("hidden");
}
function renderMemoryList() {
  const list = $("memoryList");
  list.innerHTML = state.memory.length
    ? state.memory
        .map(
          (m, i) =>
            `<div class="mem-item"><span>${escapeHtml(m)}</span><button type="button" data-i="${i}">✕</button></div>`
        )
        .join("")
    : `<p class="muted sm">No memories yet. Add facts or say “remember that…”</p>`;
  list.querySelectorAll("button").forEach((b) => {
    b.onclick = () => {
      state.memory.splice(+b.dataset.i, 1);
      saveMemory();
      renderMemoryList();
    };
  });
}
function openConnectors() {
  const nAi = state.aiCatalog.count || 0;
  const nKeys = Object.values(state.aiKeys || {}).filter(Boolean).length;
  const items = [
    { name: "🌐 Google Web Search", desc: "Gemini Search grounding for live answers", on: state.prefs.web },
    { name: "📦 Order / Master Match", desc: "Fuzzy match PO lines to material codes", on: state.prefs.orders },
    { name: "🧠 Long-term Memory", desc: "Facts saved across chats (local)", on: state.prefs.memory },
    { name: "💭 Thinking view", desc: "Show model reasoning when available", on: state.prefs.thinking },
    { name: "🤖 public-apis AI catalog", desc: `${nAi} AI APIs · ${nKeys} extra keys saved`, on: state.prefs.aiApis !== false },
    { name: "⚡ public-apis auto-switch", desc: "LLM keys → free no-key APIs (Wiki, Dict, Translate…)", on: state.prefs.autoFailover !== false },
    { name: "🆓 Free catalog APIs", desc: "Wikipedia, Dictionary, LibreTranslate, Jina, FX, jokes — no key", on: true },
    { name: "🔑 Catalog chat keys", desc: `${nKeys} keys · ready ${listReadyProviders().map((p) => p.label).join("/") || "none"}`, on: nKeys > 0 || !!state.apiKey },
    { name: "📄 File upload", desc: "PDF, Excel, images in chat", on: true },
    { name: "📋 Clipboard / Export", desc: "Copy answers & order TSV", on: true },
    { name: "🔗 URL fetch tool", desc: "Read public web pages via tool", on: true },
    { name: "💾 Local history", desc: "Chats stored on this device", on: true },
    { name: "📴 Offline shell", desc: "PWA service worker caches app", on: true },
    { name: "📊 Master Excel", desc: `${state.master.length} products loaded`, on: state.master.length > 0 },
  ];
  $("connGrid").innerHTML = items
    .map(
      (c) => `<div class="conn-card"><h3>${c.name}</h3><p>${c.desc}</p><div class="${c.on ? "on" : "off"}">${c.on ? "● ACTIVE" : "○ OFF / N/A"}</div></div>`
    )
    .join("");
  $("connectorsModal").classList.remove("hidden");
}
function closeSidebar() {
  $("sidebar").classList.remove("open");
  $("sidebarBackdrop").classList.add("hidden");
}
function openSidebar() {
  $("sidebar").classList.add("open");
  $("sidebarBackdrop").classList.remove("hidden");
}

/* ---------------- bind ---------------- */
function bind() {
  $("btnSend").onclick = sendMessage;
  $("msgInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });
  $("msgInput").addEventListener("input", () => {
    const t = $("msgInput");
    t.style.height = "auto";
    t.style.height = Math.min(t.scrollHeight, 160) + "px";
  });
  $("fileInput").onchange = () => {
    state.pendingFiles.push(...$("fileInput").files);
    $("fileInput").value = "";
    renderAttach();
  };
  $("btnNewChat").onclick = () => {
    createChat();
    renderChatList();
    renderMessages();
    closeSidebar();
  };
  $("btnMenu").onclick = () => {
    if ($("sidebar").classList.contains("open")) closeSidebar();
    else openSidebar();
  };
  $("sidebarBackdrop").onclick = closeSidebar;
  $("btnTheme").onclick = () => applyTheme(state.theme === "dark" ? "light" : "dark");
  $("btnSettings").onclick = openSettings;
  $("btnMemory").onclick = openMemory;
  $("btnAiApis").onclick = openAiApis;
  $("btnConnectors").onclick = openConnectors;
  $("btnCloseSettings").onclick = () => $("settingsModal").classList.add("hidden");
  $("btnCloseMemory").onclick = () => $("memoryModal").classList.add("hidden");
  $("btnCloseConnectors").onclick = () => $("connectorsModal").classList.add("hidden");
  $("btnCloseAiApis").onclick = () => $("aiApisModal").classList.add("hidden");
  $("btnSaveSettings").onclick = () => {
    state.apiKey = $("apiKeyInput").value.trim();
    state.model = resolveModel($("modelSelect").value);
    state.systemExtra = $("systemPrompt").value.trim();
    collectAiKeysFromForm();
    if ($("chkAutoFailover")) {
      state.prefs.autoFailover = $("chkAutoFailover").checked;
      savePrefs();
    }
    localStorage.setItem(STORAGE.apiKey, state.apiKey);
    localStorage.setItem(STORAGE.model, state.model);
    localStorage.setItem(STORAGE.system, state.systemExtra);
    $("settingsModal").classList.add("hidden");
    updateProviderPill();
    setStatus("Saved · pool " + listReadyProviders().map((p) => p.label).join("/"));
  };
  $("chkAutoFailover")?.addEventListener("change", (e) => {
    state.prefs.autoFailover = e.target.checked;
    savePrefs();
    updateProviderPill();
  });
  ["aiApiSearch", "aiApiCat", "aiApiTag"].forEach((id) => {
    $(id)?.addEventListener("input", renderAiApiList);
    $(id)?.addEventListener("change", renderAiApiList);
  });
  $("aiApiCallableOnly")?.addEventListener("change", renderAiApiList);
  $("btnToggleKey").onclick = () => {
    const i = $("apiKeyInput");
    i.type = i.type === "password" ? "text" : "password";
    $("btnToggleKey").textContent = i.type === "password" ? "Show" : "Hide";
  };
  $("chkThinking").onchange = (e) => {
    state.prefs.thinking = e.target.checked;
    savePrefs();
  };
  $("chkWeb").onchange = (e) => {
    state.prefs.web = e.target.checked;
    savePrefs();
  };
  $("chkOrderTools").onchange = (e) => {
    state.prefs.orders = e.target.checked;
    savePrefs();
  };
  $("chkMemory").onchange = (e) => {
    state.prefs.memory = e.target.checked;
    savePrefs();
  };
  $("chkAiApis").onchange = (e) => {
    state.prefs.aiApis = e.target.checked;
    savePrefs();
  };
  $("historySearch").oninput = renderChatList;
  $("btnAddMemory").onclick = () => {
    const v = $("memoryInput").value.trim();
    if (!v) return;
    state.memory.unshift(v);
    saveMemory();
    $("memoryInput").value = "";
    renderMemoryList();
  };
  $("btnClearMemory").onclick = () => {
    if (confirm("Clear all memory?")) {
      state.memory = [];
      saveMemory();
      renderMemoryList();
    }
  };
  $("btnClearHistory").onclick = () => {
    if (confirm("Delete ALL chats?")) {
      state.chats = [];
      createChat();
      saveChats();
      renderChatList();
      renderMessages();
    }
  };
  $("btnExportChat").onclick = () => {
    const c = getActive();
    if (!c) return;
    const blob = new Blob([JSON.stringify(c, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `chat-${c.title.slice(0, 20)}.json`;
    a.click();
  };
  $("btnExportAll").onclick = () => {
    const blob = new Blob(
      [
        JSON.stringify(
          {
            chats: state.chats,
            memory: state.memory,
            rules: state.rules,
            prefs: state.prefs,
            aiKeys: state.aiKeys,
            master_count: state.master.length,
            ai_apis_count: state.aiCatalog.count,
          },
          null,
          2
        ),
      ],
      { type: "application/json" }
    );
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "mohan-ai-backup.json";
    a.click();
  };
  $("importAllInput").onchange = async (e) => {
    try {
      const data = JSON.parse(await e.target.files[0].text());
      if (data.chats) state.chats = data.chats;
      if (data.memory) state.memory = data.memory;
      if (data.rules) state.rules = data.rules;
      if (data.prefs) state.prefs = { ...state.prefs, ...data.prefs };
      if (data.aiKeys) {
        state.aiKeys = data.aiKeys;
        saveAiKeys();
      }
      saveChats();
      saveMemory();
      localStorage.setItem(STORAGE.rules, JSON.stringify(state.rules));
      savePrefs();
      renderChatList();
      renderMessages();
      alert("Imported");
    } catch (err) {
      alert("Import failed: " + err.message);
    }
    e.target.value = "";
  };
  $("masterFileInput").onchange = async (e) => {
    const f = e.target.files?.[0];
    if (!f || !window.XLSX) return;
    try {
      const wb = XLSX.read(await f.arrayBuffer(), { type: "array" });
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: "" });
      const h = rows[0].map((x) => String(x).toLowerCase());
      let ci = h.findIndex((x) => /material|code/.test(x));
      let ni = h.findIndex((x) => /desc|product|name/.test(x));
      if (ci < 0) ci = 1;
      if (ni < 0) ni = 2;
      const out = [];
      for (let i = 1; i < rows.length; i++) {
        const code = String(rows[i][ci] ?? "").trim();
        const name = String(rows[i][ni] ?? "").trim();
        if (code && name) out.push({ code, name });
      }
      state.master = out;
      localStorage.setItem(STORAGE.master, JSON.stringify(out));
      rebuildBrandIndex();
      $("masterStatus").textContent = `${out.length} products`;
      setStatus("Master updated");
    } catch (err) {
      alert(err.message);
    }
    e.target.value = "";
  };
  $("btnConfirmYes").onclick = () => {
    $("confirmModal").classList.add("hidden");
    state.confirmResolver?.(true);
  };
  $("btnConfirmNo").onclick = () => {
    $("confirmModal").classList.add("hidden");
    state.confirmResolver?.(false);
  };

  // viewport
  const apply = () => {
    try {
      if (window.visualViewport)
        $("app").style.height = Math.round(window.visualViewport.height) + "px";
    } catch (_) {}
  };
  window.visualViewport?.addEventListener("resize", apply);
  apply();
}

async function init() {
  // cache DOM
  [
    "app","sidebar","chatList","messages","msgInput","btnSend","fileInput","attachPreview",
    "settingsModal","memoryModal","connectorsModal","statusPill","chatTitle","sidebarBackdrop",
  ].forEach((id) => (els[id] = $(id)));

  applyTheme(state.theme);
  $("chkThinking").checked = !!state.prefs.thinking;
  $("chkWeb").checked = state.prefs.web !== false;
  $("chkOrderTools").checked = state.prefs.orders !== false;
  $("chkMemory").checked = state.prefs.memory !== false;
  if ($("chkAiApis")) $("chkAiApis").checked = state.prefs.aiApis !== false;
  state.prefs.web = $("chkWeb").checked;
  state.prefs.orders = $("chkOrderTools").checked;
  state.prefs.memory = $("chkMemory").checked;
  state.prefs.thinking = $("chkThinking").checked;
  state.prefs.aiApis = $("chkAiApis") ? $("chkAiApis").checked : true;
  if (state.prefs.autoFailover === undefined) state.prefs.autoFailover = true;
  if ($("chkAutoFailover")) $("chkAutoFailover").checked = state.prefs.autoFailover !== false;

  setupPdf();
  bind();
  seedRules();
  if (!state.chats.length) createChat();
  else state.activeId = state.chats[0].id;

  renderChatList();
  renderMessages();
  await loadMaster();
  await loadAiCatalog();
  rebuildChatCascadeFromCatalog();
  $("masterStatus").textContent = `${state.master.length} products`;
  updateProviderPill();
  const pool = listReadyProviders().map((p) => p.label).join("/");
  setStatus(`Ready · ${state.master.length} SKUs · ${state.aiCatalog.count || 0} AI APIs` + (pool ? ` · ${pool}` : ""));

  // Optional: keys improve quality; free APIs work without
  if (!state.apiKey && !aiKey("groq") && !aiKey("huggingface") && !aiKey("deepai")) {
    setStatus("Ready · free catalog APIs (add Gemini/Groq anytime)");
  }

  if ("serviceWorker" in navigator) {
    try { await navigator.serviceWorker.register("./sw.js"); } catch (_) {}
  }
}

init();
