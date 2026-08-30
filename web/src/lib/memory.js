// MOHAN Memory — persistent user facts (localStorage in browser, in-memory in Node).
// Learns from natural conversation: naam, pasand/napasand, sheher, sapne, explicit
// "yaad rakho: ..." notes. Injected into every chat payload by persona.js.

const KEY = 'mohan.memory.v1';
const MAX_FACTS = 60;
const hasLS = typeof localStorage !== 'undefined';

// ---- tiny storage (browser + Node-safe) ----
let cache = null;
function load() {
  if (cache) return cache;
  try {
    const raw = hasLS ? localStorage.getItem(KEY) : null;
    const j = raw ? JSON.parse(raw) : null;
    cache = Array.isArray(j) ? j : [];
  } catch { cache = []; }
  return cache;
}
function persist() {
  if (!cache) return;
  try { if (hasLS) localStorage.setItem(KEY, JSON.stringify(cache.slice(-MAX_FACTS))); } catch { /* quota — memory stays in RAM */ }
}

// ---- helpers ----
const stopTail = /^(.+?)(?:\s+(?:hai|hain|ho|hna|he|hoon|hun|hu|ji|bhai|yaar|bhaiya|thank|thanks|ok|okay|na|nahi|nahin|to|tau))+\s*[.!?]*$/iu;
function cleanTail(s) {
  let t = (s || '').trim().replace(/\s+/g, ' ').replace(/[.!?,;:]+$/, '');
  for (let i = 0; i < 3; i++) t = t.replace(stopTail, '$1').trim();
  return t;
}
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const normKey = (s) => (s || '').toLowerCase().replace(/[^a-z0-9\u0900-\u097F]+/g, '');

const PATTERNS = [
  { k: 'naam', re: /\b(?:mera\s+naam|my\s+name(?:'s|\s+is)|naam\s+hai\s+mera)\s+([\p{L}][\p{L} '.-]{1,38})/iu },
  { k: 'naam', re: /\bmujhe\s+([\p{L}][\p{L}']{1,20})\s+(?:bulate|bulaya|kehte|kaha)\s+(?:hain|hai)/iu },
  { k: 'pasand', re: /\b(?:mujhe|muje|hamein|hame)\s+(.{2,80}?)\s+pasand\s+(?:aata|aati|aate|hota|hoti|hote)?\s*(?:hai|hain)?/iu },
  { k: 'pasand', re: /\bi\s+(?:really\s+)?(?:like|love|enjoy)\s+(.{2,80}?)(?:[.!?]|$)/i },
  { k: 'napasand', re: /\b(?:mujhe|muje)\s+(.{2,80}?)\s+(?:pasand\s+nahi|nahi\s+pasand|bilkul\s+pasand\s+nahi)/iu },
  { k: 'napasand', re: /\bi\s+(?:hate|dislike|don't\s+like|do\s+not\s+like|can't\s+stand)\s+(.{2,80}?)(?:[.!?]|$)/i },
  { k: 'sheher', re: /\b([\p{L}][\p{L} ]{1,30}?)\s+(?:me|mein|sheher|city)\s+(?:rehta|rehti|raha|rahti)\s+(?:hun|hoon|hun|hu)/iu },
  { k: 'sheher', re: /\bi\s+(?:live|am\s+living|currently\s+live)\s+in\s+([\p{L}][\p{L} .'-]{1,38})/iu },
  { k: 'sapna', re: /\bmujhe\s+(.{2,60}?)\s+banna\s+hai/iu },
  { k: 'sapna', re: /\bi\s+want\s+to\s+become\s+(?:an?\s+)?(.{2,60}?)(?:[.!?]|$)/i },
  { k: 'kaam', re: /\bmera\s+(?:kaam|job|profession|pehla)\s+(?:hai|hota\s+hai)\s*([\p{L}][\p{L} ]{1,30})/iu },
  { k: 'note', re: /(?:yaad\s+rakho|yaad\s+rakhiye|remember(?:\s+this|\s+it|\s+karo)?)\s*[:\-\u2014]\s*(.{2,140})/iu },
];

// words that would make "i am <x>" / "main <x> hun" a feeling, not an identity
const FEELING_RE = /^(fine|good|great|ok|okay|happy|sad|tired|busy|sorry|hungry|here|back|ready|excited|bored|thik|theek|accha|achha|bura|khush|thak\s+gada|thaka)\b/i;

function pushFacts(out, k, v) {
  const val = k === 'naam' || k === 'sheher' ? cap(cleanTail(v)) : cleanTail(v);
  if (!val || val.length < 2) return;
  if (k === 'naam' && FEELING_RE.test(val)) return;
  if (/^(the|a|an|to|and|but|so|that|this|kya|nahi)$/i.test(val)) return;
  out.push({ k, v: val });
}

// ---- public API ----
export function remember(text) {
  const t = (text || '').slice(0, 600);
  if (!t) return [];
  const facts = [];
  for (const p of PATTERNS) {
    const m = t.match(p.re);
    if (m && m[1]) pushFacts(facts, p.k, m[1]);
  }
  if (!facts.length) return [];
  const list = load();
  const added = [];
  for (const f of facts) {
    const dup = list.some((x) => x.k === f.k && normKey(x.v) === normKey(f.v));
    if (!dup) { list.push({ ...f, at: Date.now() }); added.push(f); }
  }
  if (added.length) { while (list.length > MAX_FACTS) list.shift(); cache = list; persist(); }
  return added;
}

export function getFacts() { return [...load()]; }
export function memoryCount() { return load().length; }
export function forgetAll() { cache = []; try { if (hasLS) localStorage.removeItem(KEY); } catch { /* noop */ } return true; }

// System-prompt block; '' when nothing learned yet.
export function memoryBlock() {
  const list = load();
  if (!list.length) return '';
  const lines = list.slice(-20).map((f) => `- ${f.k}: ${f.v}`);
  return ['[USER MEMORY — in facts ko yaad rakho aur answers me naturally use karo:]', ...lines].join('\n');
}
