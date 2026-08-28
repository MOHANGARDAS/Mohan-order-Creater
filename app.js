/**
 * Mohan AI v21 — Zero-issue free real chatbot
 * Multi free LLM failover + retry + optional free-tier keys
 * No order tools / fixed FAQ — live model every turn
 */

const APP_VER = "v21";

const STORAGE = {
  chats: "mohan_chats_v21",
  theme: "mohan_theme_v21",
  engine: "mohan_engine_v21",
  system: "mohan_system_v21",
  gemini: "mohan_key_gemini",
  groq: "mohan_key_groq",
  openrouter: "mohan_key_or",
};

const BASE_SYSTEM = `You are Mohan AI — a normal, helpful real chatbot (like ChatGPT / Gemini).
Answer anything: knowledge, coding, life, fun, writing, math, ideas, Hinglish chat.
You are NOT an order bot and NOT a fixed FAQ. Every reply is live AI reasoning.

Style:
- Clear Hinglish when user writes Hinglish; otherwise natural English.
- Use clean markdown: **bold**, short headings, bullets, tables when useful.
- Be direct and useful. Short when user is short; deeper when asked.
- Put the final answer in the main reply content (not only internal reasoning).
- Never dump raw API errors, HTTP codes, or stack traces.`;

const FREE_ENGINE_DEFS = [
  {
    id: "llm7-llama",
    label: "LLM7 Llama",
    kind: "llm7",
    model: "meta-Llama-3.1-8B-Instruct-Turbo",
    free: true,
    noKey: true,
  },
  {
    id: "llm7-mistral",
    label: "LLM7 Mistral",
    kind: "llm7",
    model: "mistral-Nemo-Instruct-2407",
    free: true,
    noKey: true,
  },
  {
    id: "llm7-codestral",
    label: "LLM7 Codestral",
    kind: "llm7",
    model: "codestral-latest",
    free: true,
    noKey: true,
  },
  {
    id: "llm7-gptoss",
    label: "LLM7 GPT-OSS",
    kind: "llm7",
    model: "gpt-oss",
    free: true,
    noKey: true,
  },
  {
    id: "llm7-minimax",
    label: "LLM7 MiniMax",
    kind: "llm7",
    model: "minimax-m2.7",
    free: true,
    noKey: true,
  },
  {
    id: "pollinations",
    label: "Pollinations",
    kind: "pollinations",
    model: "openai-fast",
    free: true,
    noKey: true,
  },
];

const KEYED = {
  groq: {
    id: "groq",
    label: "Groq",
    kind: "openai",
    base: "https://api.groq.com/openai/v1",
    model: "llama-3.3-70b-versatile",
    keyName: "groq",
  },
  gemini: {
    id: "gemini",
    label: "Gemini",
    kind: "gemini",
    model: "gemini-2.0-flash",
    keyName: "gemini",
  },
  openrouter: {
    id: "openrouter",
    label: "OpenRouter",
    kind: "openai",
    base: "https://openrouter.ai/api/v1",
    model: "meta-llama/llama-3.3-70b-instruct:free",
    keyName: "openrouter",
  },
};

function loadJSON(k, fb) {
  try {
    const v = JSON.parse(localStorage.getItem(k) || "null");
    return v == null ? fb : v;
  } catch {
    return fb;
  }
}

const state = {
  theme: localStorage.getItem(STORAGE.theme) || "dark",
  engine: localStorage.getItem(STORAGE.engine) || "auto",
  systemExtra: localStorage.getItem(STORAGE.system) || "",
  keys: {
    gemini: localStorage.getItem(STORAGE.gemini) || "",
    groq: localStorage.getItem(STORAGE.groq) || "",
    openrouter: localStorage.getItem(STORAGE.openrouter) || "",
  },
  chats: loadJSON(STORAGE.chats, []),
  activeId: null,
  pendingFiles: [],
  busy: false,
  lastEngine: "",
  cooldownUntil: 0,
  engineCooldown: {}, // id -> ts
  groupCooldown: {}, // group -> ts
};

const $ = (id) => document.getElementById(id);
const uid = () => "c_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function truncate(s, n) {
  s = String(s || "");
  return s.length > n ? s.slice(0, n) + "…" : s;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function engineGroup(engine) {
  if (!engine) return "x";
  if (engine.kind === "llm7") return "llm7";
  if (engine.kind === "pollinations") return "pollinations";
  return engine.id || engine.kind || "x";
}

function isCooling(engine) {
  const now = Date.now();
  const g = engineGroup(engine);
  if ((state.groupCooldown[g] || 0) > now) return true;
  if ((state.engineCooldown[engine.id] || 0) > now) return true;
  return false;
}

function markCooldown(engine, seconds) {
  const ms = Math.min(Math.max(Number(seconds) || 8, 2), 45) * 1000;
  const until = Date.now() + ms;
  state.engineCooldown[engine.id] = until;
  state.groupCooldown[engineGroup(engine)] = until;
}

function parseRetryAfter(err, data, text) {
  const blob = JSON.stringify(data || {}) + " " + (text || "") + " " + (err && err.message || "");
  const m = blob.match(/retry after\s*(\d+)/i) || blob.match(/"retry_after"\s*:\s*(\d+)/);
  if (m) return Math.min(45, Math.max(2, parseInt(m[1], 10)));
  if (err && err.status === 429) return 12;
  if (err && err.rate) return 8;
  return 0;
}

function markdown(text) {
  try {
    if (window.marked) {
      marked.setOptions({ breaks: true, gfm: true });
      return marked.parse(String(text || ""));
    }
  } catch (_) {}
  return escapeHtml(text)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\n/g, "<br>");
}

function normalize(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function saveChats() {
  const slim = state.chats.slice(0, 40).map((c) => ({
    ...c,
    messages: (c.messages || []).slice(-60).map((m) => ({
      id: m.id,
      role: m.role,
      text: m.text,
      ts: m.ts,
      engine: m.engine,
      files: m.files,
    })),
  }));
  try {
    localStorage.setItem(STORAGE.chats, JSON.stringify(slim));
  } catch {
    state.chats = state.chats.slice(0, 10);
    try {
      localStorage.setItem(STORAGE.chats, JSON.stringify(state.chats));
    } catch (_) {}
  }
}

function getActive() {
  return state.chats.find((c) => c.id === state.activeId) || null;
}

function createChat() {
  const c = {
    id: uid(),
    title: "New chat",
    created: Date.now(),
    updated: Date.now(),
    messages: [],
  };
  state.chats.unshift(c);
  state.activeId = c.id;
  saveChats();
  return c;
}

function setStatus(t) {
  const p = $("statusPill");
  if (p) p.textContent = t;
}

function setModelPill(t) {
  const p = $("modelPill");
  if (p) p.textContent = t;
}

function applyTheme(th) {
  state.theme = th === "light" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", state.theme);
  localStorage.setItem(STORAGE.theme, state.theme);
  const b = $("btnTheme");
  if (b) b.textContent = state.theme === "dark" ? "◐" : "◑";
}

function closeSidebar() {
  $("sidebar")?.classList.remove("open");
  $("sidebarBackdrop")?.classList.add("hidden");
}

function openSidebar() {
  $("sidebar")?.classList.add("open");
  $("sidebarBackdrop")?.classList.remove("hidden");
}

function fullSystem() {
  return BASE_SYSTEM + (state.systemExtra ? "\n\nExtra user prefs:\n" + state.systemExtra : "");
}

/* ---------- files ---------- */
async function fileToTextOrImage(file) {
  const name = file.name || "file";
  const mime = file.type || "";
  if (mime.startsWith("text/") || /\.(txt|md|csv|json|log)$/i.test(name)) {
    const t = await file.text();
    return { kind: "text", name, text: t.slice(0, 40000) };
  }
  if (mime.startsWith("image/")) {
    return { kind: "image", name, mime };
  }
  return { kind: "text", name, text: `(file: ${name})` };
}

/* ---------- HTTP helpers ---------- */
async function fetchJSON(url, opts = {}, timeoutMs = 45000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal });
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { raw: text };
    }
    return { ok: res.ok, status: res.status, data, text };
  } finally {
    clearTimeout(t);
  }
}

function pickMessageText(data) {
  // OpenAI-style
  const msg = data?.choices?.[0]?.message;
  if (msg) {
    let c = msg.content;
    if (Array.isArray(c)) {
      c = c.map((p) => (typeof p === "string" ? p : p?.text || "")).join("");
    }
    c = String(c || "").trim();
    if (c) return c;
    // reasoning-only models: salvage short final line
    const r = String(msg.reasoning || msg.reasoning_content || "").trim();
    if (r) {
      const lines = r.split(/\n+/).map((x) => x.trim()).filter(Boolean);
      const last = lines[lines.length - 1] || "";
      // if reasoning contains a quoted final answer try that
      const m = r.match(/["“]([^"”]{2,200})["”]\s*$/);
      if (m) return m[1];
      if (last.length > 2 && last.length < 400 && !/user says|we need|should/i.test(last)) return last;
    }
  }
  if (typeof data?.content === "string" && data.content.trim()) return data.content.trim();
  if (typeof data?.response === "string" && data.response.trim()) return data.response.trim();
  if (typeof data?.raw === "string" && data.raw.trim() && !data.raw.trim().startsWith("{"))
    return data.raw.trim();
  const g =
    data?.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("").trim() || "";
  if (g) return g;
  return "";
}

function isRateLimited(status, data, text) {
  if (status === 429 || status === 402 || status === 503 || status === 502) return true;
  const s = JSON.stringify(data || {}) + (text || "");
  return /rate.?limit|queue full|too many|payment required|capacity|overloaded/i.test(s);
}

/* ---------- engines ---------- */
async function callLlm7(engine, messages, system) {
  const body = {
    model: engine.model,
    messages: [{ role: "system", content: system }, ...messages],
    temperature: 0.75,
    max_tokens: 2048,
  };
  const { ok, status, data, text } = await fetchJSON(
    "https://api.llm7.io/v1/chat/completions",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
    },
    50000
  );
  if (!ok) {
    const err = new Error(data?.error?.message || "LLM7 " + status);
    err.status = status;
    err.rate = isRateLimited(status, data, text);
    err.retryAfter = parseRetryAfter(err, data, text);
    err.data = data;
    err.rawText = text;
    throw err;
  }
  const out = pickMessageText(data);
  if (!out) {
    const err = new Error("Empty reply");
    err.retryable = true;
    throw err;
  }
  return { text: out, engine: engine.id, label: engine.label };
}

async function callPollinations(engine, messages, system) {
  const body = {
    model: engine.model || "openai-fast",
    messages: [{ role: "system", content: system }, ...messages],
    temperature: 0.75,
  };
  let { ok, status, data, text } = await fetchJSON(
    "https://text.pollinations.ai/openai",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    50000
  );

  if (!ok && isRateLimited(status, data, text)) {
    // brief wait + GET single-turn fallback
    await sleep(1200);
    const last = [...messages].reverse().find((m) => m.role === "user")?.content || "Hello";
    const prompt = encodeURIComponent(
      system.slice(0, 400) + "\n\nUser: " + String(last).slice(0, 1500) + "\nAssistant:"
    );
    const r2 = await fetchJSON("https://text.pollinations.ai/" + prompt, {}, 40000);
    if (r2.ok) {
      const t = pickMessageText(r2.data) || String(r2.text || "").trim();
      if (t && !t.startsWith("{")) return { text: t, engine: engine.id, label: engine.label };
    }
  }

  if (!ok) {
    const err = new Error(data?.error || data?.error?.message || "Pollinations " + status);
    err.status = status;
    err.rate = isRateLimited(status, data, text);
    throw err;
  }
  const out = pickMessageText(data) || String(data?.raw || text || "").trim();
  if (!out || /^\{/.test(out)) {
    const err = new Error("Empty Pollinations reply");
    err.retryable = true;
    throw err;
  }
  return { text: out, engine: engine.id, label: engine.label };
}

async function callOpenAICompat(engine, messages, system) {
  const key = state.keys[engine.keyName];
  if (!key) throw new Error(engine.label + " key missing");
  const { ok, status, data, text } = await fetchJSON(
    engine.base.replace(/\/$/, "") + "/chat/completions",
    {
      method: "POST",
      headers: {
        Authorization: "Bearer " + key,
        "Content-Type": "application/json",
        "HTTP-Referer": location.origin,
        "X-Title": "Mohan AI",
      },
      body: JSON.stringify({
        model: engine.model,
        messages: [{ role: "system", content: system }, ...messages],
        temperature: 0.8,
      }),
    },
    55000
  );
  if (!ok) {
    const err = new Error(data?.error?.message || engine.label + " " + status);
    err.status = status;
    err.rate = isRateLimited(status, data, text);
    throw err;
  }
  const out = pickMessageText(data);
  if (!out) throw new Error("Empty " + engine.label + " reply");
  return { text: out, engine: engine.id, label: engine.label };
}

async function callGemini(engine, messages, system) {
  const key = state.keys.gemini;
  if (!key) throw new Error("Gemini key missing");
  const url =
    "https://generativelanguage.googleapis.com/v1beta/models/" +
    engine.model +
    ":generateContent?key=" +
    encodeURIComponent(key);
  const contents = [];
  let first = true;
  for (const m of messages) {
    const role = m.role === "assistant" ? "model" : "user";
    let t = m.content;
    if (first && role === "user") {
      t = system + "\n\n---\n" + t;
      first = false;
    }
    contents.push({ role, parts: [{ text: t }] });
  }
  if (!contents.length) contents.push({ role: "user", parts: [{ text: system + "\n\nHi" }] });
  const { ok, status, data, text } = await fetchJSON(
    url,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents,
        generationConfig: { temperature: 0.85, maxOutputTokens: 4096 },
      }),
    },
    55000
  );
  if (!ok) {
    const err = new Error(data?.error?.message || "Gemini " + status);
    err.status = status;
    err.rate = isRateLimited(status, data, text);
    throw err;
  }
  const out = pickMessageText(data);
  if (!out) throw new Error("Empty Gemini reply");
  return { text: out, engine: engine.id, label: engine.label };
}

async function runOneEngine(engine, messages, system) {
  if (engine.kind === "llm7") return callLlm7(engine, messages, system);
  if (engine.kind === "pollinations") return callPollinations(engine, messages, system);
  if (engine.kind === "openai") return callOpenAICompat(engine, messages, system);
  if (engine.kind === "gemini") return callGemini(engine, messages, system);
  throw new Error("Unknown engine");
}

function buildQueue() {
  const pref = state.engine || "auto";
  const free = [...FREE_ENGINE_DEFS];
  const keyed = [];
  if (state.keys.groq) keyed.push(KEYED.groq);
  if (state.keys.gemini) keyed.push(KEYED.gemini);
  if (state.keys.openrouter) keyed.push(KEYED.openrouter);

  if (pref === "pollinations") {
    return [free.find((e) => e.id === "pollinations"), ...free.filter((e) => e.id !== "pollinations"), ...keyed].filter(Boolean);
  }
  if (pref === "llm7") {
    return [...free.filter((e) => e.kind === "llm7"), free.find((e) => e.id === "pollinations"), ...keyed].filter(Boolean);
  }
  if (pref === "gemini" && state.keys.gemini) {
    return [KEYED.gemini, ...free, ...keyed.filter((k) => k.id !== "gemini")];
  }
  if (pref === "groq" && state.keys.groq) {
    return [KEYED.groq, ...free, ...keyed.filter((k) => k.id !== "groq")];
  }
  if (pref === "openrouter" && state.keys.openrouter) {
    return [KEYED.openrouter, ...free, ...keyed.filter((k) => k.id !== "openrouter")];
  }
  // auto: free first (rotated by time), then keys
  const rot = Math.floor(Date.now() / 60000) % free.length;
  const rotated = free.slice(rot).concat(free.slice(0, rot));
  return [...rotated, ...keyed];
}

async function generateReply(historyMessages) {
  const system = fullSystem();
  const messages = historyMessages.map((m) => ({
    role: m.role === "model" || m.role === "assistant" ? "assistant" : "user",
    content: String(m.content || m.text || "").slice(0, 12000),
  }));

  const trimmed = messages.slice(-16);
  const tried = [];
  let lastErr = null;

  async function wave(tag) {
    const queue = buildQueue().filter((e) => e && !isCooling(e));
    // if everything cooling, still try least-cooled free engine after short wait
    let list = queue;
    if (!list.length) {
      const all = buildQueue().filter(Boolean);
      all.sort((a, b) => (state.engineCooldown[a.id] || 0) - (state.engineCooldown[b.id] || 0));
      const waitMs = Math.max(0, Math.min(20000, (state.groupCooldown[engineGroup(all[0])] || 0) - Date.now()));
      if (waitMs > 400) {
        setStatus("Cooling " + Math.ceil(waitMs / 1000) + "s…");
        await sleep(waitMs + 200);
      }
      list = buildQueue().filter(Boolean);
    }

    for (const engine of list) {
      if (engine.keyName && !state.keys[engine.keyName]) continue;
      if (isCooling(engine)) continue;

      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          setStatus("Thinking · " + engine.label + (attempt ? " · retry" : tag ? " · " + tag : "") + "…");
          setModelPill(engine.label);
          const out = await runOneEngine(engine, trimmed, system);
          state.lastEngine = out.engine;
          return out;
        } catch (err) {
          lastErr = err;
          const ra = err.retryAfter || parseRetryAfter(err, err.data, err.rawText);
          tried.push(engine.label + (err.message ? ": " + String(err.message).slice(0, 50) : ""));
          console.warn(APP_VER, engine.id, err);
          if (err.rate || err.status === 429 || err.status === 402 || ra) {
            markCooldown(engine, ra || 10);
            // llm7 is shared quota — cool whole group
            if (engine.kind === "llm7") markCooldown(engine, ra || 12);
            await sleep(Math.min(2500, 400 + attempt * 900));
            continue;
          }
          if (err.retryable && attempt === 0) {
            await sleep(600);
            continue;
          }
          break;
        }
      }
    }
    return null;
  }

  // Wave 1
  let out = await wave("");
  if (out) return out;

  // Wave 2 after short cool — different rotation
  setStatus("Switching free engine…");
  await sleep(1500);
  out = await wave("alt");
  if (out) return out;

  // Wave 3: wait for shortest group cooldown (max 18s)
  const now = Date.now();
  const waits = Object.values(state.groupCooldown || {}).map((t) => t - now).filter((x) => x > 0);
  const wait = waits.length ? Math.min(18000, Math.max(...waits.map((x) => Math.min(x, 18000)))) : 5000;
  setStatus("Waiting free slot · " + Math.ceil(wait / 1000) + "s…");
  await sleep(wait + 300);
  // clear expired
  for (const k of Object.keys(state.groupCooldown)) {
    if (state.groupCooldown[k] <= Date.now()) delete state.groupCooldown[k];
  }
  for (const k of Object.keys(state.engineCooldown)) {
    if (state.engineCooldown[k] <= Date.now()) delete state.engineCooldown[k];
  }
  out = await wave("final");
  if (out) return out;

  const soft =
    "# Thodi der baad try\n\n" +
    "Free AI engines abhi rate-limit pe hain (public free quota).\n\n" +
    "**Best fix (still free):**\n" +
    "1. Message pe **Retry** (20–30 sec baad)\n" +
    "2. Settings → **Groq** ya **Gemini** free key (1 min) — almost zero fail\n\n" +
    "_Auto multi-engine + wait already try ho chuka._";
  const e = new Error(soft);
  e.soft = true;
  e.detail = tried.slice(0, 5).join(" · ");
  throw e;
}

/* ---------- UI ---------- */
function renderChatList() {
  const q = normalize($("historySearch")?.value || "");
  const list = $("chatList");
  if (!list) return;
  list.innerHTML = "";
  for (const c of state.chats) {
    if (
      q &&
      !normalize(c.title).includes(q) &&
      !(c.messages || []).some((m) => normalize(m.text || "").includes(q))
    )
      continue;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "chat-item" + (c.id === state.activeId ? " active" : "");
    btn.innerHTML =
      `<span class="t">${escapeHtml(c.title || "Chat")}</span>` +
      `<span class="del" title="Delete">✕</span>`;
    btn.onclick = (e) => {
      if (e.target.closest(".del")) {
        e.stopPropagation();
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
  if (!box) return;
  const chat = getActive();
  if ($("chatTitle")) $("chatTitle").textContent = chat?.title || "Mohan AI";
  if ($("chatSub")) $("chatSub").textContent = "Real AI · free · " + APP_VER;

  if (!chat || !chat.messages.length) {
    box.innerHTML = `
      <div class="welcome-hero">
        <div class="welcome-kicker">Real AI chatbot · ${APP_VER}</div>
        <h2>Mohan AI</h2>
        <p>Normal chatbot — har message pe <b>live free LLM</b>. Fixed scripts / order tools nahi.</p>
        <p class="sm">Auto: LLM7 + Pollinations (no key). Optional free keys: Groq / Gemini / OpenRouter.</p>
        <div class="suggestions">
          <button type="button" data-s="Hi! Tum kaun ho aur kya kar sakte ho?">Hi</button>
          <button type="button" data-s="Explain black holes simply in Hinglish">Explain</button>
          <button type="button" data-s="Write a short funny story">Story</button>
          <button type="button" data-s="Help me plan my day productively">Plan</button>
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
  const isUser = m.role === "user";
  let body = "";
  if (!isUser) {
    const lab = m.engine
      ? FREE_ENGINE_DEFS.find((e) => e.id === m.engine)?.label ||
        KEYED[m.engine]?.label ||
        m.engine
      : "";
    body += `<div class="msg-label">Mohan AI${lab ? " · " + escapeHtml(lab) : ""}</div>`;
  }
  if (isUser) {
    body += `<div class="md">${escapeHtml(m.text || "").replace(/\n/g, "<br>")}</div>`;
    if (m.files?.length)
      body += `<div class="file-chip">📎 ${escapeHtml(m.files.join(", "))}</div>`;
  } else {
    body += `<div class="md arena-md">${markdown(m.text || "")}</div>`;
    body += `<div class="msg-actions">
      <button type="button" data-act="copy">Copy</button>
      <button type="button" data-act="retry">Retry</button>
    </div>`;
  }
  if (isUser) {
    wrap.innerHTML = `<div class="msg-row user-row"><div class="bubble user-bubble">${body}</div></div>`;
  } else {
    wrap.innerHTML = `<div class="msg-row bot-row"><div class="avatar">M</div><div class="bubble bot-bubble">${body}</div></div>`;
  }
  wrap.querySelectorAll("[data-act]").forEach((btn) => {
    btn.onclick = async () => {
      if (btn.dataset.act === "copy") {
        try {
          await navigator.clipboard.writeText(m.text || "");
          setStatus("Copied");
        } catch {
          setStatus("Copy failed");
        }
      }
      if (btn.dataset.act === "retry") {
        const chat = getActive();
        if (!chat) return;
        const idx = chat.messages.findIndex((x) => x.id === m.id);
        let uIdx = -1;
        for (let i = idx - 1; i >= 0; i--) {
          if (chat.messages[i].role === "user") {
            uIdx = i;
            break;
          }
        }
        if (uIdx >= 0) {
          chat.messages = chat.messages.slice(0, uIdx + 1);
          saveChats();
          renderMessages();
          await runAssistant();
        }
      }
    };
  });
  return wrap;
}

function renderAttach() {
  const el = $("attachPreview");
  if (!el) return;
  if (!state.pendingFiles.length) {
    el.classList.add("hidden");
    el.innerHTML = "";
    return;
  }
  el.classList.remove("hidden");
  el.innerHTML = state.pendingFiles
    .map(
      (f, i) =>
        `<span class="attach-chip">${escapeHtml(f.name)} <button type="button" data-i="${i}">✕</button></span>`
    )
    .join("");
  el.querySelectorAll("button").forEach((b) => {
    b.onclick = () => {
      state.pendingFiles.splice(+b.dataset.i, 1);
      renderAttach();
    };
  });
}

function addTyping() {
  removeTyping();
  const wrap = document.createElement("div");
  wrap.className = "msg bot";
  wrap.id = "typingEl";
  wrap.innerHTML = `<div class="msg-row bot-row"><div class="avatar">M</div><div class="bubble bot-bubble"><div class="msg-label">Mohan AI</div><span class="typing-dots"><i></i><i></i><i></i></span></div></div>`;
  $("messages")?.appendChild(wrap);
  const box = $("messages");
  if (box) box.scrollTop = box.scrollHeight;
}

function removeTyping() {
  $("typingEl")?.remove();
}

async function sendMessage() {
  if (state.busy) return;
  const input = $("msgInput");
  const text = (input?.value || "").trim();
  const files = [...state.pendingFiles];
  if (!text && !files.length) return;

  let chat = getActive();
  if (!chat) chat = createChat();
  if (!chat.messages.length && $("messages")) $("messages").innerHTML = "";

  let userText = text || (files.length ? "(attachment)" : "");
  const parsed = [];
  for (const f of files) {
    try {
      parsed.push(await fileToTextOrImage(f));
    } catch (_) {}
  }
  const textBits = parsed
    .filter((p) => p.kind === "text")
    .map((p) => `--- ${p.name} ---\n${p.text}`);
  if (textBits.length) userText += (userText ? "\n\n" : "") + textBits.join("\n\n");
  const imgs = parsed.filter((p) => p.kind === "image");
  if (imgs.length) {
    userText +=
      (userText ? "\n\n" : "") +
      imgs.map((im) => `[User attached image: ${im.name}]`).join("\n");
  }

  const userMsg = {
    id: uid(),
    role: "user",
    text: userText,
    files: files.map((f) => f.name),
    ts: Date.now(),
  };
  chat.messages.push(userMsg);
  chat.updated = Date.now();
  if (chat.title === "New chat") {
    chat.title = truncate(userText.replace(/\s+/g, " "), 42) || "New chat";
  }
  if (input) {
    input.value = "";
    input.style.height = "auto";
  }
  state.pendingFiles = [];
  renderAttach();
  saveChats();
  renderChatList();
  $("messages")?.appendChild(renderMsg(userMsg));
  const box = $("messages");
  if (box) box.scrollTop = box.scrollHeight;

  await runAssistant();
}

async function runAssistant() {
  const chat = getActive();
  if (!chat || state.busy) return;
  state.busy = true;
  if ($("btnSend")) $("btnSend").disabled = true;
  setStatus("Thinking…");
  addTyping();

  try {
    const hist = chat.messages
      .filter((m) => m.role === "user" || m.role === "model" || m.role === "assistant")
      .slice(-24)
      .map((m) => ({
        role: m.role === "user" ? "user" : "assistant",
        content: m.text || "",
      }));

    const out = await generateReply(hist);
    removeTyping();
    const botMsg = {
      id: uid(),
      role: "model",
      text: out.text,
      engine: out.engine,
      ts: Date.now(),
    };
    chat.messages.push(botMsg);
    chat.updated = Date.now();
    saveChats();
    renderChatList();
    $("messages")?.appendChild(renderMsg(botMsg));
    const box = $("messages");
    if (box) box.scrollTop = box.scrollHeight;
    setStatus("Ready");
    setModelPill((out.label || out.engine) + " · live");
  } catch (err) {
    console.error(err);
    removeTyping();
    const softText =
      err.soft && err.message
        ? err.message
        : "# Thodi der baad try\n\nFree engines busy hain. **Retry** dabao — auto dusra engine try karega.\n\nSettings me free Groq/Gemini key bhi add kar sakte ho.";
    const botMsg = {
      id: uid(),
      role: "model",
      text: softText,
      ts: Date.now(),
      engine: "retry",
    };
    chat.messages.push(botMsg);
    saveChats();
    $("messages")?.appendChild(renderMsg(botMsg));
    setStatus("Retry");
  } finally {
    state.busy = false;
    if ($("btnSend")) $("btnSend").disabled = false;
  }
}

function openSettings() {
  if ($("engineSelect")) $("engineSelect").value = state.engine || "auto";
  if ($("geminiKey")) $("geminiKey").value = state.keys.gemini || "";
  if ($("groqKey")) $("groqKey").value = state.keys.groq || "";
  if ($("openrouterKey")) $("openrouterKey").value = state.keys.openrouter || "";
  if ($("systemPrompt")) $("systemPrompt").value = state.systemExtra || "";
  $("settingsModal")?.classList.remove("hidden");
}

function bind() {
  $("btnSend") && ($("btnSend").onclick = sendMessage);
  $("msgInput")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });
  $("msgInput")?.addEventListener("input", () => {
    const t = $("msgInput");
    t.style.height = "auto";
    t.style.height = Math.min(t.scrollHeight, 160) + "px";
  });
  $("fileInput") &&
    ($("fileInput").onchange = () => {
      const files = $("fileInput").files;
      if (files?.length) state.pendingFiles.push(...files);
      $("fileInput").value = "";
      renderAttach();
    });
  $("btnNewChat") &&
    ($("btnNewChat").onclick = () => {
      createChat();
      renderChatList();
      renderMessages();
      closeSidebar();
    });
  $("btnMenu") &&
    ($("btnMenu").onclick = () => {
      if ($("sidebar")?.classList.contains("open")) closeSidebar();
      else openSidebar();
    });
  $("sidebarBackdrop") && ($("sidebarBackdrop").onclick = closeSidebar);
  $("btnTheme") &&
    ($("btnTheme").onclick = () => applyTheme(state.theme === "dark" ? "light" : "dark"));
  $("btnSettings") && ($("btnSettings").onclick = openSettings);
  $("btnCloseSettings") &&
    ($("btnCloseSettings").onclick = () => $("settingsModal")?.classList.add("hidden"));
  $("btnSaveSettings") &&
    ($("btnSaveSettings").onclick = () => {
      state.engine = $("engineSelect")?.value || "auto";
      state.keys.gemini = ($("geminiKey")?.value || "").trim();
      state.keys.groq = ($("groqKey")?.value || "").trim();
      state.keys.openrouter = ($("openrouterKey")?.value || "").trim();
      state.systemExtra = ($("systemPrompt")?.value || "").trim();
      localStorage.setItem(STORAGE.engine, state.engine);
      localStorage.setItem(STORAGE.gemini, state.keys.gemini);
      localStorage.setItem(STORAGE.groq, state.keys.groq);
      localStorage.setItem(STORAGE.openrouter, state.keys.openrouter);
      localStorage.setItem(STORAGE.system, state.systemExtra);
      $("settingsModal")?.classList.add("hidden");
      setStatus("Saved");
      setModelPill(state.engine === "auto" ? "Auto free LLM" : state.engine);
    });
  document.querySelectorAll("[data-toggle]").forEach((btn) => {
    btn.onclick = () => {
      const id = btn.getAttribute("data-toggle");
      const i = $(id);
      if (!i) return;
      i.type = i.type === "password" ? "text" : "password";
      btn.textContent = i.type === "password" ? "Show" : "Hide";
    };
  });
  $("historySearch") && ($("historySearch").oninput = renderChatList);
  $("btnClearAll") &&
    ($("btnClearAll").onclick = () => {
      if (!confirm("Delete all chats?")) return;
      state.chats = [];
      createChat();
      saveChats();
      renderChatList();
      renderMessages();
    });
  $("settingsModal")?.addEventListener("click", (e) => {
    if (e.target.id === "settingsModal") $("settingsModal").classList.add("hidden");
  });

  const apply = () => {
    try {
      if (window.visualViewport && $("app"))
        $("app").style.height = Math.round(window.visualViewport.height) + "px";
    } catch (_) {}
  };
  window.visualViewport?.addEventListener("resize", apply);
  window.addEventListener("resize", apply);
  apply();
}

async function init() {
  applyTheme(state.theme);
  bind();
  // migrate keys / chats from prior versions
  if (!state.keys.gemini) state.keys.gemini = localStorage.getItem("mohan_key_gemini") || "";
  if (!state.keys.groq) state.keys.groq = localStorage.getItem("mohan_key_groq") || "";
  if (!state.keys.openrouter) state.keys.openrouter = localStorage.getItem("mohan_key_or") || "";
  if (!state.chats.length) {
    const old = loadJSON("mohan_chats_v20", []) || loadJSON("mohan_chats_v19", []);
    if (old && old.length) state.chats = old;
  }
  if (!state.chats.length) createChat();
  else state.activeId = state.chats[0].id;
  renderChatList();
  renderMessages();
  setModelPill(state.engine === "auto" ? "Auto free LLM" : state.engine);
  setStatus("Ready · " + APP_VER);
  if ("serviceWorker" in navigator) {
    try {
      await navigator.serviceWorker.register("./sw.js?v=21");
    } catch (_) {}
  }
}

init();
