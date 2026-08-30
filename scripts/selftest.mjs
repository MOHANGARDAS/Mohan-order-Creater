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

// ====== v2 STRONG STACK tests ======
import { detectLang } from '../web/src/lib/lang.js';
import { remember, getFacts, forgetAll, memoryBlock } from '../web/src/lib/memory.js';
import { systemPrompt, buildChatPayload, shouldAutoImage } from '../web/src/engine/persona.js';
import { boostPrompt } from '../web/src/engine/images.js';
import { shortlistPuterModels, shortlistGenModels } from '../web/src/engine/engine.js';

// 9. Language Lock detection
{
  check('Devanagari → Hindi lock', detectLang('आप कैसे हैं?').code, 'hi');
  check('Hinglish detected', detectLang('kaise ho bhai, kya haal hai').code, 'hi-latin');
  check('plain English stays English', detectLang('What is quantum computing?').code, 'en');
  check('Arabic script detected', detectLang('كيف حالك اليوم').code, 'ar');
  const lock = detectLang('mujhe ek website banao').lock;
  check('Hinglish lock forbids Devanagari', /Roman\/Latin script/.test(lock), true);
}

// 10. MOHAN Memory — learn, dedupe, block
{
  forgetAll();
  const a = remember('mera naam Raj hai');
  check('learns naam from Hinglish', a.some((f) => f.k === 'naam' && /raj/i.test(f.v)), true);
  const b = remember('my name is Raj'); // same fact, different phrasing → no dup
  check('no duplicate facts across phrasings', b.filter((f) => f.k === 'naam').length, 0);
  remember('mujhe cricket pasand hai');
  remember('yaad rakho: office Monday se open hoga');
  const facts = getFacts();
  check('pasand learned', facts.some((f) => f.k === 'pasand' && /cricket/i.test(f.v)), true);
  check('explicit note learned', facts.some((f) => f.k === 'note' && /office/i.test(f.v)), true);
  const blk = memoryBlock();
  check('memory block lists facts', /naam: Raj/.test(blk) && /cricket/.test(blk), true);
  check("feelings don't become names", remember('i am fine').length, 0);
  forgetAll();
  check('forgetAll clears memory', getFacts().length, 0);
}

// 11. persona payload — language lock + memory + window
{
  const hist = [
    { role: 'user', content: 'kaise ho bhai' },
    { role: 'assistant', content: 'Main badhiya hoon!' },
  ];
  const payload = buildChatPayload(hist, 'chat', { memory: '- naam: Raj' });
  const sys = payload[0].content;
  check('lock injected (Hinglish)', /LANGUAGE LOCK/.test(sys) && /Hinglish/.test(sys), true);
  check('memory injected', /naam: Raj/.test(sys), true);
  check('quality bar present', /TOP-TIER model/.test(sys), true);
  // long history digest
  const long = [];
  for (let i = 0; i < 30; i++) long.push({ role: 'user', content: `topic-${i}` }, { role: 'assistant', content: 'ok' });
  const lp = buildChatPayload(long, 'chat');
  check('history window respected (≤26 incl digest)', lp.length <= 27, true);
  check('older topics digested', lp[1] && lp[1].content.includes('topic-5'), true);
}

// 12. auto image intent routing
{
  check('"Generate an image" routes to image engine', shouldAutoImage('Generate an image of Mumbai skyline'), true);
  check('Hinglish image request routes', shouldAutoImage('ek poster banao cricket ka'), true);
  check('"photo chahiye" routes', shouldAutoImage('Mumbai skyline ki photo chahiye'), true);
  check('coding image question does NOT route', shouldAutoImage('HTML me image kaise lagate hain?'), false);
  check('sheet request does NOT route to image', shouldAutoImage('excel sheet banao budget ki'), false);
}

// 13. cinematic image prompt booster
{
  const bare = boostPrompt('a cat on the moon');
  check('bare prompt gets cinematic boost', /cinematic lighting/.test(bare), true);
  const styled = boostPrompt('a cat on the moon, watercolor painting style');
  check('styled prompt passes through untouched', styled, 'a cat on the moon, watercolor painting style');
}

// 14. strong-first model shortlists
{
  const puter = shortlistPuterModels(['gpt-4o-mini', 'claude-sonnet-4', 'gpt-5', 'llama-4-maverick', 'o4-mini', 'gemini-2.5-flash', 'mistral-large', 'some-unknown-model']);
  check('frontier models ranked before mini', puter.indexOf('gpt-5') < puter.indexOf('gpt-4o-mini'), true);
  check('claude ranked before unknown', puter.indexOf('claude-sonnet-4') < puter.indexOf('some-unknown-model'), true);
  check('puter shortlist capped at 8', puter.length <= 8, true);
  const gen = shortlistGenModels(['grok-4', 'qwen-max', 'flux-image', 'glm-4.5', 'deepseek-v3', 'llama-4', 'mistral-medium', 'random-thing']);
  check('gen shortlist strong-first (grok first)', gen[0], 'grok-4');
  check('gen shortlist excludes image models', gen.includes('flux-image'), false);
  check('gen shortlist capped at 6', gen.length <= 6, true);
}

if (fails) {
  console.error(`\n${fails} test(s) failed`);
  process.exit(1);
}
console.log('\nAll MOHAN engine-core tests passed ✓');
