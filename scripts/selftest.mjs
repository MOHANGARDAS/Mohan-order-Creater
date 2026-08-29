// MOHAN engine-core self test (Node, no deps). Run: npm run selftest
import {
  createSlot, pickSlot, slotStatus, markRateLimit, markFail, markTimeout,
  markAuthDead, markSuccess, RATE_BASE_MS,
} from '../web/src/engine/core.js';

let fails = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? '✓' : '✗ FAIL'} ${name}${ok ? '' : ` — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`);
  if (!ok) fails++;
};

const T0 = 1_790_000_000_000;

// 1. healthy pool prefers lowest tier
{
  const a = createSlot({ id: 'a', tier: 1, model: 'm1', provider: 'p', carrier: 'c' });
  const b = createSlot({ id: 'b', tier: 2, model: 'm2', provider: 'p', carrier: 'c' });
  check('prefers lowest tier when healthy', pickSlot([a, b], T0).slot.id, 'a');
}

// 2. rate limit → cooldown → rotation → automatic restore
{
  const a = createSlot({ id: 'a', tier: 1, model: 'm1', provider: 'p', carrier: 'c' });
  const b = createSlot({ id: 'b', tier: 2, model: 'm2', provider: 'p', carrier: 'c' });
  markRateLimit(a, 0, T0);
  check('429 puts slot on cooldown', slotStatus(a, T0 + 1).state, 'cooling');
  check('rotation switches to healthy slot', pickSlot([a, b], T0 + 1).slot.id, 'b');
  check('cooldown auto-restores (limit reset)', slotStatus(a, T0 + RATE_BASE_MS + 1).state, 'ready');
  check('restored slot is picked again', pickSlot([a, b], T0 + RATE_BASE_MS + 1).slot.id, 'a');
}

// 3. exponential backoff on repeated failures
{
  const a = createSlot({ id: 'a', tier: 1, model: 'm1', provider: 'p', carrier: 'c' });
  markRateLimit(a, 0, T0);
  markRateLimit(a, 0, T0 + 1);
  const wait = slotStatus(a, T0 + 2).waitMs;
  check('second 429 backs off harder', wait >= RATE_BASE_MS * 2 - 5, true);
}

// 4. retry-after header wins when larger
{
  const a = createSlot({ id: 'a', tier: 1, model: 'm1', provider: 'p', carrier: 'c' });
  markRateLimit(a, 90_000, T0);
  check('retry-after respected', slotStatus(a, T0).waitMs, 90_000);
}

// 5. everything busy → engine waits for the earliest slot instead of erroring
// a: timeout-cooldown = 15s from T0 → free at T0+15000; b: fail-cooldown = 12s
// from T0+1000 → free at T0+13000 (earlier!). Engine must wait for b.
{
  const a = createSlot({ id: 'a', tier: 1, model: 'm1', provider: 'p', carrier: 'c' });
  const b = createSlot({ id: 'b', tier: 2, model: 'm2', provider: 'p', carrier: 'c' });
  markTimeout(a, T0);
  markFail(b, 'server', T0 + 1000);
  const pick = pickSlot([a, b], T0 + 2000);
  check('all-busy picks earliest available (wait mode)', [pick.immediate, pick.slot.id, pick.state], [false, 'b', 'cooling']);
  check('wait time is finite', pick.waitMs > 0 && pick.waitMs <= 60_000, true);
}

// 6. auth-required slot rests long-term and is skipped
{
  const a = createSlot({ id: 'a', tier: 1, model: 'm1', provider: 'p', carrier: 'c' });
  markAuthDead(a, T0);
  check('auth-dead slot skipped for 6h', slotStatus(a, T0 + 3 * 3600 * 1000).state, 'dead');
  check('dead slot comes back eventually', slotStatus(a, T0 + 7 * 3600 * 1000).state, 'ready');
}

// 7. success resets failures and cooldown immediately
{
  const a = createSlot({ id: 'a', tier: 1, model: 'm1', provider: 'p', carrier: 'c' });
  markFail(a, 'server', T0);
  markRateLimit(a, 0, T0 + 1);
  markSuccess(a, 1800, T0 + 2);
  const s = slotStatus(a, T0 + 3);
  check('success heals slot instantly (throttle only if paced)', ['ready', 'throttle'].includes(s.state), true);
  check('failures cleared', a.rt.failures, 0);
  check('latency tracked', a.rt.totalLatencyMs, 1800);
}

// 8. polite pacing (minInterval) then ready
{
  const a = createSlot({ id: 'a', tier: 1, model: 'm1', provider: 'p', carrier: 'c', minIntervalMs: 5000 });
  markSuccess(a, 500, T0);
  check('throttled right after use', slotStatus(a, T0 + 1000).state, 'throttle');
  check('free again after interval', slotStatus(a, T0 + 6000).state, 'ready');
}

if (fails) {
  console.error(`\n${fails} test(s) failed`);
  process.exit(1);
}
console.log('\nAll MOHAN engine-core tests passed ✓');
