// MOHAN rotation core — pure, framework-free, unit-testable in Node.
// A "slot" = one chat endpoint (provider + model + carrier). The engine keeps
// runtime health per slot (rt) and rotates across them automatically:
// limit hit → cooldown + switch → auto-restore when the cooldown expires.

export const AUTH_DEAD_MS = 6 * 60 * 60 * 1000; // auth-required endpoints rest 6h
export const RATE_BASE_MS = 20_000;             // first rate-limit cooldown
export const RATE_CAP_MS = 5 * 60_000;
export const FAIL_BASE_MS = 12_000;
export const FAIL_CAP_MS = 5 * 60_000;
export const TIMEOUT_BASE_MS = 15_000;
export const TIMEOUT_CAP_MS = 2 * 60_000;

const growth = (failures, base, cap) => Math.min(cap, base * Math.max(1, failures + 1));

export function createSlot(cfg) {
  return {
    id: cfg.id,
    provider: cfg.provider,       // 'pollinations' | 'pollinations-gen' | 'puter'
    carrier: cfg.carrier,         // 'popenai' | 'gen' | 'legacyget' | 'puter'
    model: cfg.model,
    label: cfg.label || `${cfg.provider} · ${cfg.model}`,
    tier: cfg.tier ?? 2,          // lower = preferred when everything is healthy
    minIntervalMs: cfg.minIntervalMs ?? 4_000, // polite pacing between own calls
    rt: freshRt(),
  };
}

export function freshRt() {
  return {
    cooldownUntil: 0,
    deadUntil: 0,
    lastUsedAt: 0,
    failures: 0,
    successes: 0,
    totalLatencyMs: 0,
    lastError: null,
  };
}

export function hydrateSlot(slot, savedRt) {
  if (!savedRt) return slot;
  slot.rt = { ...freshRt(), ...savedRt };
  return slot;
}

export function slotStatus(slot, t = Date.now()) {
  const rt = slot.rt;
  if (rt.deadUntil && t < rt.deadUntil) return { state: 'dead', waitMs: rt.deadUntil - t };
  if (rt.cooldownUntil && t < rt.cooldownUntil) return { state: 'cooling', waitMs: rt.cooldownUntil - t };
  const since = t - (rt.lastUsedAt || 0);
  if (rt.lastUsedAt && since < slot.minIntervalMs) return { state: 'throttle', waitMs: slot.minIntervalMs - since };
  return { state: 'ready', waitMs: 0 };
}

export function avgLatency(slot) {
  return slot.rt.successes ? slot.rt.totalLatencyMs / slot.rt.successes : 0;
}

function score(slot, t) {
  // Lower is better. Tier dominates; failures hurt; fast history helps; LRU tiebreak.
  const lruNudge = slot.rt.lastUsedAt ? Math.min(59, (t - slot.rt.lastUsedAt) / 1e9) : 59;
  return slot.tier * 1000 + slot.rt.failures * 250 + (slot.rt.successes ? avgLatency(slot) / 40 : 55) - lruNudge;
}

export function pickSlot(slots, t = Date.now()) {
  let ready = null;
  let readyScore = Infinity;
  let next = null;
  let nextWait = Infinity;
  let nextState = 'none';
  for (const s of slots) {
    const st = slotStatus(s, t);
    if (st.state === 'ready') {
      const sc = score(s, t);
      if (sc < readyScore) { readyScore = sc; ready = s; }
    }
    if (st.waitMs < nextWait) { nextWait = st.waitMs; next = s; nextState = st.state; }
  }
  if (ready) return { slot: ready, immediate: true, waitMs: 0, state: 'ready' };
  return { slot: next, immediate: false, waitMs: nextWait, state: nextState };
}

export function markSuccess(slot, latencyMs, t = Date.now()) {
  const rt = slot.rt;
  rt.lastUsedAt = t;
  rt.failures = 0;
  rt.successes += 1;
  rt.totalLatencyMs += Math.max(0, latencyMs | 0);
  rt.cooldownUntil = 0;
  rt.lastError = null;
}

export function markRateLimit(slot, retryAfterMs = 0, t = Date.now()) {
  bump(slot, Math.max(retryAfterMs, growth(slot.rt.failures, RATE_BASE_MS, RATE_CAP_MS)), 'rate-limit', t);
}

export function markTimeout(slot, t = Date.now()) {
  bump(slot, growth(slot.rt.failures, TIMEOUT_BASE_MS, TIMEOUT_CAP_MS), 'timeout', t);
}

export function markFail(slot, kind = 'error', t = Date.now()) {
  bump(slot, growth(slot.rt.failures, FAIL_BASE_MS, FAIL_CAP_MS), kind, t);
}

export function markAuthDead(slot, t = Date.now()) {
  slot.rt.deadUntil = t + AUTH_DEAD_MS;
  slot.rt.failures += 1;
  slot.rt.lastError = 'auth';
}

function bump(slot, cooldownMs, kind, t) {
  slot.rt.failures += 1;
  slot.rt.lastUsedAt = t;
  slot.rt.cooldownUntil = t + cooldownMs;
  slot.rt.lastError = kind;
}
