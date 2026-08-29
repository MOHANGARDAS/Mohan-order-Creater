// MOHAN network adapters — every call is browser-direct against keyless public
// endpoints. No API keys anywhere, ever. Each adapter throws AdError with a
// machine-readable `kind` so the engine can decide the right cooldown.

export class AdError extends Error {
  constructor(kind, message, extra = {}) {
    super(message || kind);
    this.name = 'AdError';
    this.kind = kind; // rate-limit | timeout | network | auth | http | server | empty | model | stream-broken | exhausted
    Object.assign(this, extra);
  }
}

export const isAbort = (e) => e && e.name === 'AbortError';

export const POLL_LEGACY_OPENAI = 'https://text.pollinations.ai/openai';
export const POLL_LEGACY_ROOT = 'https://text.pollinations.ai';
export const POLL_GEN = 'https://gen.pollinations.ai';

export async function fetchT(url, init = {}, timeoutMs = 60_000, outerSignal) {
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  if (outerSignal) {
    if (outerSignal.aborted) ctrl.abort();
    else outerSignal.addEventListener('abort', onAbort, { once: true });
  }
  const to = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal, referrerPolicy: 'no-referrer' });
  } catch (e) {
    if (outerSignal && outerSignal.aborted) { const er = new Error('aborted'); er.name = 'AbortError'; throw er; }
    if (e && e.name === 'AbortError') throw new AdError('timeout', 'request timed out');
    throw new AdError('network', (e && e.message) || 'network error');
  } finally {
    clearTimeout(to);
    if (outerSignal) outerSignal.removeEventListener('abort', onAbort);
  }
}

async function ensureOk(res) {
  if (res.ok) return;
  const ra = res.headers.get('retry-after');
  const retryAfterMs = ra ? (parseFloat(ra) || 0) * 1000 : 0;
  let body = '';
  try { body = (await res.text()).slice(0, 240); } catch { /* ignore */ }
  const kind =
    res.status === 429 ? 'rate-limit'
    : res.status === 401 || res.status === 403 || res.status === 402 ? 'auth'
    : res.status >= 500 ? 'server' : 'http';
  throw new AdError(kind, `HTTP ${res.status}`, { status: res.status, retryAfterMs, body });
}

async function streamSSE(res, onEvent) {
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') return;
      onEvent(data);
    }
  }
}

function fakeStream(text, onToken) {
  const CH = 240;
  for (let i = 0; i < text.length; i += CH) onToken(text.slice(i, i + CH));
}

const trimFor = (messages) =>
  messages
    .filter((m) => m && m.content)
    .map((m) => ({ role: m.role, content: String(m.content).slice(0, m.role === 'system' ? 3000 : 6000) }));

// ---- Pollinations OpenAI-compatible POST (legacy host + unified gen host) ----
async function pollinationsOpenAI(slot, messages, opts, url) {
  const body = { model: slot.model, messages: trimFor(messages), stream: true };
  if (url === POLL_LEGACY_OPENAI) body.private = true;
  const res = await fetchT(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, 75_000, opts.signal);
  await ensureOk(res);
  const ct = (res.headers.get('content-type') || '').toLowerCase();
  if (ct.includes('text/event-stream')) {
    let got = false;
    await streamSSE(res, (data) => {
      let j;
      try { j = JSON.parse(data); } catch { return; }
      const choice = j.choices && j.choices[0];
      const d = choice && (choice.delta || choice.message);
      if (!d) return;
      const rc = d.reasoning_content || d.reasoning;
      if (rc) { got = true; opts.onThinking && opts.onThinking(String(rc)); }
      if (d.content) { got = true; opts.onToken(String(d.content)); }
    });
    if (!got) throw new AdError('empty', 'empty stream');
    return;
  }
  const j = await res.json().catch(() => null);
  const content = j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
  if (typeof content === 'string' && content.trim()) { fakeStream(content, opts.onToken); return; }
  if (j && j.error) throw new AdError(j.error.code ? 'http' : 'server', String(j.error.message || j.error));
  throw new AdError('empty', 'malformed response');
}

// ---- Pollinations legacy simple GET (last-resort carrier, same free model) ----
async function pollinationsLegacyGet(slot, messages, opts) {
  const sys = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n').slice(0, 500);
  const convo = messages
    .filter((m) => m.role !== 'system')
    .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
    .join('\n')
    .slice(-1100); // keep encoded URL well under limits (unicode-safe)
  const url = `${POLL_LEGACY_ROOT}/${encodeURIComponent(convo)}?model=${encodeURIComponent(slot.model)}${sys ? `&system=${encodeURIComponent(sys)}` : ''}`;
  const res = await fetchT(url, {}, 90_000, opts.signal);
  await ensureOk(res);
  const text = (await res.text()).trim();
  if (!text) throw new AdError('empty', 'empty response');
  // error payloads sometimes arrive as 200 text
  if (/^\{"error"/.test(text)) throw new AdError('server', text.slice(0, 120));
  fakeStream(text, opts.onToken);
}

// ---- Puter.js (browser-native, zero-key, many frontier-class models) ----
let puterPromise = null;
export function loadPuter(timeoutMs = 9000) {
  if (typeof window === 'undefined') return Promise.resolve(null);
  if (window.puter && window.puter.ai) return Promise.resolve(window.puter);
  if (puterPromise) return puterPromise;
  puterPromise = new Promise((resolve) => {
    const done = (p) => resolve(p || null);
    const s = document.createElement('script');
    s.src = 'https://js.puter.com/v2/';
    s.async = true;
    const to = setTimeout(() => done(null), timeoutMs);
    s.onload = () => { clearTimeout(to); done(window.puter && window.puter.ai ? window.puter : null); };
    s.onerror = () => { clearTimeout(to); done(null); };
    document.head.appendChild(s);
  });
  return puterPromise;
}

export async function listPuterModels() {
  try {
    const p = await loadPuter();
    if (!p || !p.ai || !p.ai.listModels) return [];
    const lm = await Promise.race([
      p.ai.listModels(),
      new Promise((_, rj) => setTimeout(() => rj(new Error('timeout')), 8000)),
    ]);
    if (Array.isArray(lm)) {
      return lm.map((m) => (typeof m === 'string' ? m : (m && (m.id || m.name)))).filter(Boolean);
    }
  } catch { /* discovery is best-effort */ }
  return [];
}

function normalizePuterErr(e) {
  const m = String((e && (e.message || e.error)) || e || 'puter error');
  if (/limit|rate|too many|quota|throttl/i.test(m)) return new AdError('rate-limit', m);
  if (/auth|token|sign ?in|unauthor|forbidden|permission/i.test(m)) return new AdError('auth', m);
  if (/model.*(not found|invalid|unknown|unavailable)/i.test(m)) return new AdError('model', m);
  if (/timeout|timed out/i.test(m)) return new AdError('timeout', m);
  return new AdError('network', m);
}

async function puterChat(slot, messages, { signal, onToken }) {
  const p = await loadPuter();
  if (!p) throw new AdError('network', 'puter unavailable');
  const msgs = trimFor(messages).map((m) => ({ role: m.role, content: m.content }));
  let resp;
  try {
    resp = await Promise.race([
      p.ai.chat(msgs, { model: slot.model, stream: true }),
      new Promise((_, rj) => setTimeout(() => rj(new AdError('timeout', 'puter timeout')), 75_000)),
    ]);
  } catch (e) {
    if (e instanceof AdError) throw e;
    throw normalizePuterErr(e);
  }
  let got = false;
  try {
    if (resp && typeof resp[Symbol.asyncIterator] === 'function') {
      let guard = 0;
      for await (const part of resp) {
        if (signal && signal.aborted) {
          try { resp.return && resp.return(); } catch { /* noop */ }
          const er = new Error('aborted'); er.name = 'AbortError'; throw er;
        }
        const txt = part && (part.text ?? (part.message && part.message.content) ?? '');
        if (txt) { got = true; onToken(String(txt)); }
        if (++guard > 6000) break;
      }
    } else if (resp) {
      const txt = typeof resp === 'string' ? resp : (resp.text ?? (resp.message && resp.message.content) ?? '');
      if (txt) { got = true; onToken(String(txt)); }
    }
  } catch (e) {
    if (isAbort(e)) throw e;
    throw normalizePuterErr(e);
  }
  if (!got) throw new AdError('empty', 'puter returned nothing');
}

// ---- model discovery ----
export async function listPollinationsLegacyModelDefs() {
  try {
    const res = await fetchT(`${POLL_LEGACY_ROOT}/models`, {}, 9000);
    if (!res.ok) return [];
    const j = await res.json();
    if (!Array.isArray(j)) return [];
    return j
      .map((m) => (typeof m === 'string' ? { name: m } : m))
      .filter((m) => m && m.name && (!m.output_modalities || m.output_modalities.includes('text')));
  } catch { return []; }
}

export async function listPollinationsGenModels() {
  try {
    const res = await fetchT(`${POLL_GEN}/v1/models`, {}, 9000);
    if (!res.ok) return [];
    const j = await res.json();
    const arr = Array.isArray(j && j.data) ? j.data : Array.isArray(j) ? j : [];
    return arr.map((m) => (typeof m === 'string' ? m : (m.id || m.name))).filter(Boolean);
  } catch { return []; }
}

export function adapterChat(slot, messages, opts) {
  switch (slot.carrier) {
    case 'popenai': return pollinationsOpenAI(slot, messages, opts, POLL_LEGACY_OPENAI);
    case 'gen': return pollinationsOpenAI(slot, messages, opts, `${POLL_GEN}/v1/chat/completions`);
    case 'legacyget': return pollinationsLegacyGet(slot, messages, opts);
    case 'puter': return puterChat(slot, messages, opts);
    default: throw new AdError('config', `unknown carrier ${slot.carrier}`);
  }
}
