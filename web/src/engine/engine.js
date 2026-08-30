// MOHAN self-healing rotation engine.
// - Discovers available free models at boot (best-effort, zero config)
// - Streams from the best healthy slot; on ANY limit/error it cools that slot
//   down and instantly continues with the next one
// - If everything is briefly busy it waits (visible countdown) instead of erroring
// - Slot health persists in localStorage, so limits are remembered across reloads
import {
  createSlot, hydrateSlot, pickSlot, slotStatus, avgLatency,
  markSuccess, markRateLimit, markTimeout, markFail, markAuthDead,
} from './core.js';
import {
  adapterChat, listPuterModels, listPollinationsGenModels, listPollinationsLegacyModelDefs, AdError, isAbort,
} from './adapters.js';

const LS_KEY = 'mohan.engine.v2';
const MAX_WAIT_MS = 40_000; // wait up to this long for a slot to cool down before giving up
const MAX_ATTEMPTS = 12;

let slots = [];
let ready = false;
let readyPromise = null;
const healthSubs = new Set();
let saveTimer = null;
let healthTimer = null;

function loadSavedRt() {
  try { return (JSON.parse(localStorage.getItem(LS_KEY) || '{}').slots) || {}; } catch { return {}; }
}
function saveSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      const out = {};
      for (const s of slots) out[s.id] = s.rt;
      localStorage.setItem(LS_KEY, JSON.stringify({ savedAt: Date.now(), slots: out }));
    } catch { /* storage full/blocked — engine still works */ }
  }, 350);
}

export function onHealth(fn) { healthSubs.add(fn); return () => healthSubs.delete(fn); }
function emitHealth() {
  clearTimeout(healthTimer);
  healthTimer = setTimeout(() => {
    const h = getHealth();
    healthSubs.forEach((f) => { try { f(h); } catch { /* noop */ } });
  }, 100);
}

function baseSlots() {
  // v2 STRONG STACK — frontier-class models first (baked-in so they exist even
  // if discovery is slow); gpt-4o-mini demoted to speed fallback. Baked puter
  // slots that discovery can't confirm get dropped in ensureReady().
  return [
    createSlot({ id: 'puter:claude-sonnet-4', provider: 'puter', carrier: 'puter', model: 'claude-sonnet-4', label: 'Puter · Claude Sonnet 4', tier: 1, minIntervalMs: 3000 }),
    createSlot({ id: 'puter:gpt-4.1', provider: 'puter', carrier: 'puter', model: 'gpt-4.1', label: 'Puter · GPT-4.1', tier: 1, minIntervalMs: 3000 }),
    createSlot({ id: 'puter:gemini-2.5-flash', provider: 'puter', carrier: 'puter', model: 'gemini-2.5-flash', label: 'Puter · Gemini 2.5 Flash', tier: 2, minIntervalMs: 3000 }),
    createSlot({ id: 'puter:gpt-4o-mini', provider: 'puter', carrier: 'puter', model: 'gpt-4o-mini', label: 'Puter · GPT-4o mini (speed)', tier: 3, minIntervalMs: 3000 }),
    createSlot({ id: 'popenai:openai-fast', provider: 'pollinations', carrier: 'popenai', model: 'openai-fast', label: 'Pollinations · openai-fast (reasoning)', tier: 2, minIntervalMs: 6000 }),
    createSlot({ id: 'legacyget:openai-fast', provider: 'pollinations', carrier: 'legacyget', model: 'openai-fast', label: 'Pollinations · simple', tier: 6, minIntervalMs: 12000 }),
  ];
}

const GEN_EXCLUDE = /(image|img|audio|tts|whisper|embed|video|veo|seedream|flux|dall|vision|moderation|realtime)/i;
export function shortlistGenModels(models) {
  // strong-first: grok / qwen-max / glm / deepseek / gemma / llama / mistral
  const prefs = [/grok/i, /qwen-max|qwen3|qwen/i, /glm/i, /deepseek/i, /gemini|gemma/i, /llama/i, /mistral|mixtral/i, /gpt/i];
  const usable = (models || []).filter((m) => !GEN_EXCLUDE.test(m));
  const picked = [];
  for (const re of prefs) {
    const hit = usable.find((m) => re.test(m) && !picked.includes(m));
    if (hit) picked.push(hit);
    if (picked.length >= 6) break;
  }
  for (const m of usable) { if (picked.length >= 6) break; if (!picked.includes(m)) picked.push(m); }
  return picked.slice(0, 6);
}

// Strongest first; small/nano models sink unless nothing else exists.
const PUTER_RANK = [
  'gpt-5', 'gpt-4.1', 'gpt-4o', 'claude-opus', 'claude-sonnet', 'claude-3.7', 'claude',
  'gemini-2.5', 'gemini', 'o4-mini', 'o4', 'o3', 'llama-4', 'llama', 'mistral-large',
  'mistral', 'deepseek', 'qwen-max', 'qwen',
];
export function shortlistPuterModels(models) {
  const list = (models || []).filter((m) => !/embed|tts|whisper|moderation|dall|image|speech/i.test(m));
  if (!list.length) return [];
  const rank = (m) => {
    const low = m.toLowerCase();
    let i = PUTER_RANK.findIndex((p) => low.includes(p));
    if (i === -1) i = 99;
    // push tiny variants down unless they are genuinely ranked (o4-mini stays)
    if (i < 99 && /mini|nano|lite|tiny|small/.test(low) && !/o4-mini/.test(low)) i += 3;
    return i;
  };
  return [...list].sort((a, b) => rank(a) - rank(b)).slice(0, 8);
}

export function ensureReady() {
  if (ready) return Promise.resolve();
  if (readyPromise) return readyPromise;
  readyPromise = (async () => {
    const saved = loadSavedRt();
    const all = baseSlots();
    try {
      // Legacy pollinations model name (authoritative for the anonymous tier)
      const defs = await listPollinationsLegacyModelDefs();
      const def = defs.find((d) => d.tier === 'anonymous') || defs[0];
      if (def && def.name) {
        for (const s of all) {
          if (s.provider === 'pollinations' && (s.carrier === 'popenai' || s.carrier === 'legacyget')) {
            s.model = def.name;
            s.id = `${s.carrier}:${def.name}`;
            if (s.carrier === 'popenai') s.label = `Pollinations · ${def.name}`;
          }
        }
      }
    } catch { /* keep baked-in model names */ }

    try {
      const genModels = shortlistGenModels(await listPollinationsGenModels());
      for (const m of genModels) {
        all.push(createSlot({ id: `gen:${m}`, provider: 'pollinations-gen', carrier: 'gen', model: m, label: `Pollinations+ · ${m}`, tier: 3, minIntervalMs: 5000 }));
      }
    } catch { /* optional tier */ }

    try {
      const puterModels = shortlistPuterModels(await listPuterModels());
      if (puterModels.length) {
        // Discovery worked → drop baked-in puter slots that puter can't confirm,
        // keep the strongest discovered models.
        const have = new Set(puterModels.map((m) => m.toLowerCase()));
        const bakedPuter = all.filter((s) => s.provider === 'puter');
        for (const s of bakedPuter) {
          if (!have.has(s.model.toLowerCase())) all.splice(all.indexOf(s), 1);
        }
      }
      for (const m of puterModels) {
        if (all.some((s) => s.provider === 'puter' && s.model.toLowerCase() === m.toLowerCase())) continue;
        all.push(createSlot({ id: `puter:${m}`, provider: 'puter', carrier: 'puter', model: m, label: `Puter · ${m}`, tier: 2, minIntervalMs: 3500 }));
      }
    } catch { /* optional tier */ }

    const seen = new Set();
    slots = all.filter((s) => (seen.has(s.id) ? false : (seen.add(s.id), true)));
    for (const s of slots) if (saved[s.id]) hydrateSlot(s, saved[s.id]);
    ready = true;
    emitHealth();
  })().catch(() => {
    const saved = loadSavedRt();
    slots = baseSlots();
    for (const s of slots) if (saved[s.id]) hydrateSlot(s, saved[s.id]);
    ready = true;
    emitHealth();
  });
  return readyPromise;
}

const sleep = (ms, signal) =>
  new Promise((resolve, reject) => {
    const t = setTimeout(() => { if (signal) signal.removeEventListener('abort', on); resolve(); }, ms);
    const on = () => { clearTimeout(t); const e = new Error('aborted'); e.name = 'AbortError'; reject(e); };
    if (signal) signal.addEventListener('abort', on, { once: true });
  });

const throwIfAbort = (signal) => {
  if (signal && signal.aborted) { const e = new Error('aborted'); e.name = 'AbortError'; throw e; }
};

function noticeFor(kind, slot) {
  const L = slot.label;
  switch (kind) {
    case 'rate-limit': return `⚡ ${L} ki limit hit hui — dusre model pe switch`;
    case 'timeout': return `🐢 ${L} slow/timeout — agle provider pe`;
    case 'auth': return `🔒 ${L} key maang raha hai — 6 ghante skip (auto-restore)`;
    case 'model': return `♻️ ${L} model retired — skip`;
    case 'server': return `🛠️ ${L} down hai — rotate ho raha`;
    case 'empty': return `🫥 ${L} se khaali reply — doosra try`;
    default: return `🔁 ${L} error — auto-rotating…`;
  }
}

function applyMark(slot, err) {
  const kind = err && err.kind ? err.kind : 'error';
  if (kind === 'rate-limit') markRateLimit(slot, err.retryAfterMs || 0);
  else if (kind === 'timeout') markTimeout(slot);
  else if (kind === 'auth' || kind === 'model' || kind === 'config') markAuthDead(slot);
  else markFail(slot, kind);
}

export async function chat({ messages, signal, onToken, onThinking, onNotice, onSlot }) {
  await ensureReady();
  throwIfAbort(signal);
  const tried = new Set();
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    throwIfAbort(signal);
    const pool = slots.filter((s) => !tried.has(s.id));
    if (!pool.length) break;
    const pick = pickSlot(pool);
    if (!pick.slot) break;
    if (!pick.immediate) {
      if (pick.waitMs > MAX_WAIT_MS) { tried.add(pick.slot.id); continue; }
      onNotice && onNotice(`⏳ sab slots busy — ${pick.slot.label} ~${Math.ceil(pick.waitMs / 1000)}s me ready, auto-wait kar raha…`, 'wait');
      await sleep(pick.waitMs, signal);
    }
    const slot = pick.slot;
    tried.add(slot.id);
    onSlot && onSlot(slot, attempt);
    const t0 = Date.now();
    let streamed = false;
    try {
      await adapterChat(slot, messages, {
        signal,
        onToken: (t) => { streamed = true; onToken && onToken(t); },
        onThinking: (t) => onThinking && onThinking(t),
      });
      markSuccess(slot, Date.now() - t0);
      saveSoon();
      emitHealth();
      return { slot, ms: Date.now() - t0 };
    } catch (e) {
      if (isAbort(e)) throw e;
      applyMark(slot, e);
      saveSoon();
      emitHealth();
      if (streamed) {
        const err = new AdError('stream-broken', 'stream interrupted mid-answer');
        err.slot = slot;
        throw err;
      }
      onNotice && onNotice(noticeFor(e.kind || 'error', slot), e.kind || 'error');
    }
  }
  throw new AdError('exhausted', 'all free lanes are busy right now');
}

export function getHealth() {
  const t = Date.now();
  return {
    ready,
    slots: slots.map((s) => {
      const st = slotStatus(s, t);
      return {
        id: s.id,
        label: s.label,
        provider: s.provider,
        model: s.model,
        tier: s.tier,
        state: st.state,
        waitMs: st.waitMs,
        failures: s.rt.failures,
        successes: s.rt.successes,
        avgMs: Math.round(avgLatency(s)),
        lastError: s.rt.lastError,
      };
    }),
  };
}

export async function refreshDiscovery() {
  ready = false;
  readyPromise = null;
  await ensureReady();
}

export function resetEngineState() {
  try { localStorage.removeItem(LS_KEY); } catch { /* noop */ }
  for (const s of slots) {
    const fresh = { cooldownUntil: 0, deadUntil: 0, lastUsedAt: 0, failures: 0, successes: 0, totalLatencyMs: 0, lastError: null };
    s.rt = fresh;
  }
  emitHealth();
}

// Debug handle for power users
if (typeof window !== 'undefined') window.__MOHAN = { getHealth, refreshDiscovery, resetEngineState };
