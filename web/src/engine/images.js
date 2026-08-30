// MOHAN image engine — keyless image generation with model/seed rotation.
import { fetchT, AdError, isAbort, POLL_GEN } from './adapters.js';

const sleep = (ms, signal) =>
  new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    const on = () => { clearTimeout(t); const e = new Error('aborted'); e.name = 'AbortError'; reject(e); };
    if (signal) signal.addEventListener('abort', on, { once: true });
  });

const rand = (n) => Math.floor(Math.random() * n);

// Cinematic prompt booster — bare/vague prompts get quality qualifiers so the
// image matches the intent (fixes "random-looking image" complaints). Prompts
// that already carry a style directive pass through untouched.
const STYLE_RE = /cinematic|realistic|photoreal|photography|photo\s*shoot|painting|watercolou?r|oil\s*on|anime|cartoon|3d\s*render|blender|poster|logo|sticker|pixel\s*art|4k|8k|detailed|lighting|digital\s*art|studio\s*ghibli|pixar|concept\s*art|vector|isometric|minimalist|black\s*and\s*white|monochrome/i;
export function boostPrompt(p) {
  const t = (p || '').trim();
  if (!t) return t;
  if (STYLE_RE.test(t)) return t;
  if (t.split(/\s+/).length > 16) return t; // long prompts usually carry their own style
  return `${t}, highly detailed, cinematic lighting, rich colors, sharp focus, professional composition`;
}

const CANDIDATES = [
  { base: 'https://image.pollinations.ai/prompt/', model: 'flux', label: 'FLUX' },
  { base: 'https://image.pollinations.ai/prompt/', model: 'turbo', label: 'Turbo' },
  { base: `${POLL_GEN}/image/`, model: 'flux', label: 'FLUX+', bare: true },
];

function buildUrl(c, prompt) {
  const seed = rand(999_999);
  const q = c.bare
    ? `?width=1024&height=1024&seed=${seed}`
    : `?model=${c.model}&width=1024&height=1024&nologo=true&seed=${seed}`;
  return `${c.base}${encodeURIComponent(prompt)}${q}`;
}

export async function generateImage(prompt, { signal, onStatus } = {}) {
  const finalPrompt = boostPrompt(prompt);
  const tries = [];
  for (let round = 0; round < 2; round++) for (const c of CANDIDATES) tries.push(c);
  for (let i = 0; i < tries.length; i++) {
    const c = tries[i];
    const url = buildUrl(c, finalPrompt);
    onStatus && onStatus(i === 0 ? `🎨 MOHAN canvas: ${c.label} se image ban rahi hai…` : `🔁 retry ${i}: ${c.label} model try ho raha…`);
    const t0 = Date.now();
    try {
      const res = await fetchT(url, {}, 120_000, signal);
      if (res.ok) {
        const blob = await res.blob();
        if (blob.type.startsWith('image/') && blob.size > 1500) {
          const urlObj = URL.createObjectURL(blob);
          return { url: urlObj, directUrl: url, provider: `pollinations/${c.model}`, ms: Date.now() - t0, blobbed: true };
        }
        throw new AdError('empty', 'bad image payload');
      }
      throw new AdError(res.status === 429 ? 'rate-limit' : 'server', `HTTP ${res.status}`, { status: res.status });
    } catch (e) {
      if (isAbort(e)) throw e;
      if (i < tries.length - 1) await sleep(i === 0 ? 5000 : 2500, signal);
    }
  }
  // Final fallback: hand the direct URL to an <img> tag (works even without fetch CORS).
  const fb = buildUrl(CANDIDATES[0], finalPrompt);
  onStatus && onStatus('🌐 direct pipeline use ho rahi hai…');
  return { url: fb, directUrl: fb, provider: 'pollinations/direct', ms: 0, blobbed: false };
}
