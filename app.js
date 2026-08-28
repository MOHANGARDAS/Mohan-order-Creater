/**
 * Mohan AI v20 — Normal real chatbot
 * Free live LLM (Pollinations, no key) + optional Gemini / Groq / OpenRouter
 * No order matching, no fixed scripts — real model answers every turn
 */

const STORAGE = {
  chats: "mohan_chats_v20",
  theme: "mohan_theme_v20",
  engine: "mohan_engine_v20",
  system: "mohan_system_v20",
  gemini: "mohan_key_gemini",
  groq: "mohan_key_groq",
  openrouter: "mohan_key_or",
};

const FREE_MODELS = {
  pollinations: {
    id: "pollinations",
    label: "Pollinations",
    free: true,
    noKey: true,
  },
  gemini: {
    id: "gemini",
    label: "Gemini Flash",
    model: "gemini-2.0-flash",
    free: true,
  },
  groq: {
    id: "groq",
    label: "Groq Llama",
    model: "llama-3.3-70b-versatile",
    free: true,
  },
  openrouter: {
    id: "openrouter",
    label: "OpenRouter free",
    model: "meta-llama/llama-3.3-70b-instruct:free",
    free: true,
  },
};

const BASE_SYSTEM = `You are Mohan AI — a normal, helpful real chatbot (like ChatGPT).
You answer anything: general knowledge, coding, life, fun, explanations, writing, math, ideas.
You are NOT an order-matching bot. You are NOT a fixed FAQ. Every reply comes from live AI reasoning.

Style (match a good agent chat):
- Clear Hinglish/English mix when user writes Hinglish.
- Markdown: **bold**, headings, bullets, tables when useful.
- Short when the user is short; deeper when they ask for detail.
- Be direct, friendly, capable. No fake "I am just a script" vibes.
- Never invent that you cannot browse if you truly cannot; be honest.
- No material/order codes unless user pastes a business task and asks you to reason about it as plain text.`;

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

function markdown(text) {
  try {
    if (window.marked) {
      marked.setOptions({ breaks: true, gfm: true });
      return marked.parse(String(text || ""));
    }
  } catch (_) {}
  return escapeHtml(text).replace(/\n/g, "<br>");
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
    state.chats = state.chats.slice(0, 12);
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
  $("btnTheme").textContent = state.theme === "dark" ? "◐" : "◑";
}

function closeSidebar() {
  $("sidebar").classList.remove("open");
  $("sidebarBackdrop").classList.add("hidden");
}

function openSidebar() {
  $("sidebar").classList.add("open");
  $("sidebarBackdrop").classList.remove("hidden");
}

/* ---------- file helpers ---------- */
async function fileToTextOrImage(file) {
  const name = file.name || "file";
  const mime = file.type || "";
  if (mime.startsWith("text/") || /\.(txt|md|csv|json|log)$/i.test(name)) {
    const t = await file.text();
    return { kind: "text", name, text: t.slice(0, 40000) };
  }
  if (mime.startsWith("image/")) {
    const b64 = await new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(String(r.result).split(",")[1] || "");
      r.onerror = rej;
      r.readAsDataURL(file);
    });
    return { kind: "image", name, mime, b64 };
  }
  return { kind: "text", name, text: `(binary file ${name} — describe if needed)` };
}

/* ---------- LLM providers (real AI) ---------- */
async function chatPollinations(messages, system) {
  const msgs = [{ role: "system", content: system }, ...messages];
  // Prefer OpenAI-compatible POST (CORS *)
  const res = await fetch("https://text.pollinations.ai/openai", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "openai",
      messages: msgs,
      temperature: 0.8,
    }),
  });
  if (!res.ok) {
    // fallback GET single-turn
    const last = messages.filter((m) => m.role === "user").pop()?.content || "Hello";
    const prompt = encodeURIComponent(system.slice(0, 500) + "\n\nUser: " + last + "\nAssistant:");
    const r2 = await fetch("https://text.pollinations.ai/" + prompt);
    if (!r2.ok) throw new Error("Pollinations " + res.status);
    return { text: await r2.text(), engine: "pollinations" };
  }
  const data = await res.json();
  const text =
    data.choices?.[0]?.message?.content ||
    data.choices?.[0]?.text ||
    data.content ||
    "";
  if (!String(text).trim()) throw new Error("Empty Pollinations reply");
  return { text: String(text).trim(), engine: "pollinations" };
}

async function chatGemini(messages, system) {
  const key = state.keys.gemini;
  if (!key) throw new Error("Gemini key missing");
  const model = "gemini-2.0-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`;
  const contents = [];
  // put system on first user
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

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents,
      generationConfig: { temperature: 0.85, maxOutputTokens: 4096 },
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error?.message || res.statusText;
    const e = new Error(msg);
    e.code = res.status;
    throw e;
  }
  const parts = data?.candidates?.[0]?.content?.parts || [];
  const text = parts.map((p) => p.text || "").join("").trim();
  if (!text) throw new Error("Empty Gemini reply");
  return { text, engine: "gemini" };
}

async function chatOpenAICompat({ base, key, model, messages, system, label }) {
  if (!key) throw new Error(label + " key missing");
  const res = await fetch(base.replace(/\/$/, "") + "/chat/completions", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + key,
      "Content-Type": "application/json",
      "HTTP-Referer": location.origin,
      "X-Title": "Mohan AI",
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "system", content: system }, ...messages],
      temperature: 0.85,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = new Error(data?.error?.message || label + " " + res.status);
    e.code = res.status;
    throw e;
  }
  const text = data.choices?.[0]?.message?.content || "";
  if (!String(text).trim()) throw new Error("Empty " + label + " reply");
  return { text: String(text).trim(), engine: label.toLowerCase() };
}

function buildEngineQueue() {
  const pref = state.engine || "auto";
  const all = [];
  const push = (id) => {
    if (!all.includes(id)) all.push(id);
  };

  if (pref === "pollinations") push("pollinations");
  else if (pref === "gemini") push("gemini");
  else if (pref === "groq") push("groq");
  else if (pref === "openrouter") push("openrouter");
  else {
    // auto: free no-key first, then optional free-tier keys
    push("pollinations");
    if (state.keys.groq) push("groq");
    if (state.keys.gemini) push("gemini");
    if (state.keys.openrouter) push("openrouter");
  }

  // always keep pollinations as last free fallback
  push("pollinations");
  return all;
}

async function runEngine(id, messages, system) {
  if (id === "pollinations") return chatPollinations(messages, system);
  if (id === "gemini") return chatGemini(messages, system);
  if (id === "groq")
    return chatOpenAICompat({
      base: "https://api.groq.com/openai/v1",
      key: state.keys.groq,
      model: FREE_MODELS.groq.model,
      messages,
      system,
      label: "Groq",
    });
  if (id === "openrouter")
    return chatOpenAICompat({
      base: "https://openrouter.ai/api/v1",
      key: state.keys.openrouter,
      model: FREE_MODELS.openrouter.model,
      messages,
      system,
      label: "OpenRouter",
    });
  throw new Error("Unknown engine");
}

async function generateReply(historyMessages) {
  const system = BASE_SYSTEM + (state.systemExtra ? "\n\nExtra:\n" + state.systemExtra : "");
  const messages = historyMessages.map((m) => ({
    role: m.role === "model" || m.role === "assistant" ? "assistant" : "user",
    content: m.content || m.text || "",
  }));

  const queue = buildEngineQueue();
  const errors = [];
  for (const id of queue) {
    // skip keyed engines without key
    if (id === "gemini" && !state.keys.gemini) continue;
    if (id === "groq" && !state.keys.groq) continue;
    if (id === "openrouter" && !state.keys.openrouter) continue;
    try {
      setStatus("Thinking · " + (FREE_MODELS[id]?.label || id) + "…");
      setModelPill(FREE_MODELS[id]?.label || id);
      const out = await runEngine(id, messages, system);
      state.lastEngine = out.engine;
      return out;
    } catch (err) {
      console.warn(id, err);
      errors.push((FREE_MODELS[id]?.label || id) + ": " + (err.message || String(err)));
      // on 429 try next
      continue;
    }
  }
  throw new Error(errors.slice(0, 3).join(" · ") || "All free engines failed");
}

/* ---------- UI ---------- */
function renderChatList() {
  const q = normalize($("historySearch")?.value || "");
  const list = $("chatList");
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
    btn.innerHTML = `<span class="t">${escapeHtml(c.title || "Chat")}</span><span class="del" title="Delete">✕</span>`;
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
  const chat = getActive();
  $("chatTitle").textContent = chat?.title || "Mohan AI";
  if (!chat || !chat.messages.length) {
    box.innerHTML = `
      <div class="welcome-hero">
        <div class="welcome-kicker">Real AI chatbot</div>
        <h2>Mohan AI</h2>
        <p>Normal chatbot — live model har baar naya jawab. Order tools / fixed scripts nahi.</p>
        <p class="sm">Default free engine: <b>Pollinations</b> (no key). Optional: Gemini / Groq / OpenRouter free keys.</p>
        <div class="suggestions">
          <button type="button" data-s="Explain black holes simply">Explain something</button>
          <button type="button" data-s="Write a short funny story in Hinglish">Write something</button>
          <button type="button" data-s="Help me plan a 1-day trip in Maharashtra">Plan with me</button>
          <button type="button" data-s="What can you do?">What can you do?</button>
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
    body += `<div class="msg-label">Mohan AI${m.engine ? ` · ${escapeHtml(m.engine)}` : ""}</div>`;
  }
  if (isUser) {
    body += `<div class="md">${escapeHtml(m.text || "").replace(/\n/g, "<br>")}</div>`;
    if (m.files?.length) body += `<div class="file-chip">📎 ${escapeHtml(m.files.join(", "))}</div>`;
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
        await navigator.clipboard.writeText(m.text || "");
        setStatus("Copied");
      }
      if (btn.dataset.act === "retry") {
        const chat = getActive();
        const idx = chat.messages.findIndex((x) => x.id === m.id);
        let u = null;
        for (let i = idx - 1; i >= 0; i--) if (chat.messages[i].role === "user") {
          u = chat.messages[i];
          break;
        }
        if (u) {
          chat.messages = chat.messages.slice(0, chat.messages.indexOf(u) + 1);
          saveChats();
          await runAssistant();
        }
      }
    };
  });
  return wrap;
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
  const wrap = document.createElement("div");
  wrap.className = "msg bot";
  wrap.id = "typingEl";
  wrap.innerHTML = `<div class="msg-row bot-row"><div class="avatar">M</div><div class="bubble bot-bubble"><div class="msg-label">Mohan AI</div><span class="typing-dots"><i></i><i></i><i></i></span></div></div>`;
  $("messages").appendChild(wrap);
  $("messages").scrollTop = $("messages").scrollHeight;
}

function removeTyping() {
  $("typingEl")?.remove();
}

async function sendMessage() {
  if (state.busy) return;
  const text = $("msgInput").value.trim();
  const files = [...state.pendingFiles];
  if (!text && !files.length) return;

  let chat = getActive();
  if (!chat) chat = createChat();
  if (!chat.messages.length) $("messages").innerHTML = "";

  // build user content
  let userText = text || (files.length ? "(attachment)" : "");
  const parsed = [];
  for (const f of files) {
    try {
      parsed.push(await fileToTextOrImage(f));
    } catch (_) {}
  }
  const textBits = parsed.filter((p) => p.kind === "text").map((p) => `--- ${p.name} ---\n${p.text}`);
  if (textBits.length) userText += (userText ? "\n\n" : "") + textBits.join("\n\n");
  // images: describe path for text-only free models
  const imgs = parsed.filter((p) => p.kind === "image");
  if (imgs.length) {
    userText +=
      (userText ? "\n\n" : "") +
      imgs.map((im) => `[User attached image: ${im.name}. Describe/help if possible.]`).join("\n");
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
  $("msgInput").value = "";
  $("msgInput").style.height = "auto";
  state.pendingFiles = [];
  renderAttach();
  saveChats();
  renderChatList();
  $("messages").appendChild(renderMsg(userMsg));
  $("messages").scrollTop = $("messages").scrollHeight;

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
    // last N turns as plain messages
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
    $("messages").appendChild(renderMsg(botMsg));
    $("messages").scrollTop = $("messages").scrollHeight;
    setStatus("Ready");
    setModelPill((FREE_MODELS[out.engine]?.label || out.engine) + " · live");
  } catch (err) {
    console.error(err);
    removeTyping();
    const botMsg = {
      id: uid(),
      role: "model",
      text:
        "# Engine busy\n\n" +
        "Free model thodi der ke liye fail ho gaya.\n\n" +
        (err.message ? `_${escapeHtml(err.message)}_\n\n` : "") +
        "Try again, or Settings me **Groq / Gemini / OpenRouter** free key add karo.",
      ts: Date.now(),
      engine: "error",
    };
    // don't use escapeHtml inside markdown path for message we control - fix
    botMsg.text =
      "# Engine busy\n\nFree model thodi der fail ho gaya.\n\n" +
      (err.message ? "`" + String(err.message).slice(0, 180) + "`\n\n" : "") +
      "Dobara bhejo, ya Settings → free key (Groq / Gemini / OpenRouter).";
    chat.messages.push(botMsg);
    saveChats();
    $("messages").appendChild(renderMsg(botMsg));
    setStatus("Try again");
  } finally {
    state.busy = false;
    $("btnSend").disabled = false;
  }
}

function openSettings() {
  $("engineSelect").value = state.engine || "auto";
  $("geminiKey").value = state.keys.gemini || "";
  $("groqKey").value = state.keys.groq || "";
  $("openrouterKey").value = state.keys.openrouter || "";
  $("systemPrompt").value = state.systemExtra || "";
  $("settingsModal").classList.remove("hidden");
}

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
  $("btnCloseSettings").onclick = () => $("settingsModal").classList.add("hidden");
  $("btnSaveSettings").onclick = () => {
    state.engine = $("engineSelect").value || "auto";
    state.keys.gemini = $("geminiKey").value.trim();
    state.keys.groq = $("groqKey").value.trim();
    state.keys.openrouter = $("openrouterKey").value.trim();
    state.systemExtra = $("systemPrompt").value.trim();
    localStorage.setItem(STORAGE.engine, state.engine);
    localStorage.setItem(STORAGE.gemini, state.keys.gemini);
    localStorage.setItem(STORAGE.groq, state.keys.groq);
    localStorage.setItem(STORAGE.openrouter, state.keys.openrouter);
    localStorage.setItem(STORAGE.system, state.systemExtra);
    $("settingsModal").classList.add("hidden");
    setStatus("Saved");
    setModelPill(
      state.engine === "auto" ? "Auto free LLM" : FREE_MODELS[state.engine]?.label || state.engine
    );
  };
  document.querySelectorAll("[data-toggle]").forEach((btn) => {
    btn.onclick = () => {
      const id = btn.getAttribute("data-toggle");
      const i = $(id);
      if (!i) return;
      i.type = i.type === "password" ? "text" : "password";
      btn.textContent = i.type === "password" ? "Show" : "Hide";
    };
  });
  $("historySearch").oninput = renderChatList;
  $("btnClearAll").onclick = () => {
    if (!confirm("Delete all chats?")) return;
    state.chats = [];
    createChat();
    saveChats();
    renderChatList();
    renderMessages();
  };

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
  applyTheme(state.theme);
  bind();
  if (!state.chats.length) createChat();
  else state.activeId = state.chats[0].id;
  renderChatList();
  renderMessages();
  setModelPill(
    state.engine === "auto" ? "Auto free LLM" : FREE_MODELS[state.engine]?.label || state.engine
  );
  setStatus("Ready · free chat");
  if ("serviceWorker" in navigator) {
    try {
      await navigator.serviceWorker.register("./sw.js");
    } catch (_) {}
  }
}

init();
