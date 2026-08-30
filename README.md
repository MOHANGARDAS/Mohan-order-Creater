# 🟣 MOHAN v2 — Free Multi-Model AI (strong stack, zero keys, zero cost)

> 🔴 **LIVE:** **https://mohangardas.github.io/Mohan-order-Creater/** (GitHub Pages se direct)

**MOHAN** (Multi-Orbit Hybrid AI Nexus) ek ChatGPT/Gemini-class AI website hai — but with a
**self-healing, keyless AI engine** built-in. Koi API key arrange karne ki zaroorat **nahi**,
koi signup **nahi**, koi paise **nahi**. Bas chalao aur use karo.

## 🆕 v2 Strong Stack

- 💪 **Frontier-first rotation** — Claude Sonnet 4 / Opus, GPT-5 / GPT-4.1 / GPT-4o,
  Gemini 2.5 Flash, Llama 4, Mistral Large, o4-mini (Puter.js) + grok / qwen-max / GLM /
  DeepSeek (Pollinations+). Mini/nano models sirf speed-fallback. Limit aaye to **next
  frontier model** pe auto-switch.
- 🧠 **MOHAN Memory** — "mera naam Raj hai", "mujhe cricket pasand hai", "yaad rakho: …"
  bolte hi seekh leta hai; har reply me yaad rakhta hai (localStorage, privacy-safe).
- 🔒 **Language Lock** — Devanagari Hindi → Devanagari jawab, Hinglish → Roman Hindi,
  English → English; Bengali/Tamil/Telugu/Gujarati/Urdu/Arabic/CJK bhi mirror hote hain.
- 🎯 **Auto intent routing** — "Generate an image of…" AUTO mode me seedha image engine
  jaata hai (text reply nahi).
- 🎬 **Cinematic prompt booster** — bare prompts me automatic quality qualifiers
  (lighting/composition/detail), styled prompts untouched.
- 📚 **Deeper context** — 24-message window + purani conversation ka topic digest.

## ✨ Features

- 💬 **ChatGPT-style chat UI** — streaming replies, markdown, code highlighting, chat history (localStorage)
- 🔁 **Auto-rotating engine** — multiple free providers/models ek saath ready rehte hain:
  - Limit hit (429) → wo slot **cooldown**, reply turant **dusre model** pe continue
  - Limit restore hote hi slot **auto-rejoin**
  - Sab busy → engine **visible countdown ke saath wait** karta hai (error nahi)
  - Engine health live panel me dikhta hai (header ka 🟢 pill)
- 🎨 **Images** — FLUX/Turbo lanes, seed + model rotation (`Image` chip)
- 📊 **Excel (.xlsx)** — `Sheet` mode / kisi bhi table wale reply se real Excel file
- 📄 **PDF** — har reply aur poori chat ka clean PDF export (print-to-pdf, Hindi fonts perfect)
- 🧠 **Thinking view** — reasoning models ka process collapsible panel me live
- 🎙️ **Voice in + out** — mic input (Hindi/Hinglish/English) + reply sunno
- 🌍 **Har language** — MOHAN usi language/script me jawab deta hai
- 🗂️ **Downloads for everything** — code blocks → files, markdown, CSV, xlsx…

## 🔓 Zero-key engine (how it works)

Sab AI calls **user ke browser se directly** keyless public endpoints pe jaati hain:

| Lane | Kya hai |
| --- | --- |
| **Puter.js** | Browser-native free access to frontier-class models (GPT/Claude/Llama class) |
| **Pollinations (legacy, anonymous tier)** | Free, no-signup text model (`openai-fast` — GPT-OSS reasoning) + images (FLUX/Turbo) |
| **Pollinations+ (unified)** | Extra model pool — agar anonymous allowed ho to auto-add |

Engine boot pe available models **discover** karta hai, har slot ka health track karta hai
(cooldown/failures/latency, localStorage me persist), aur best healthy slot khud choose karta hai.
Providers community-run free tiers hain — isliye rotation/self-healing hi MOHAN ka core design hai.

> Agar ek din koi lane slow/busy ho: kuch karna nahi — MOHAN khud switch karega.
> Header me 🟢/🟡 pill pe click karke dekh sakte ho kaun sa model live hai.

## 🚀 Run / deploy

```bash
npm install
npm run build    # dist/ me static site banti hai
npm start        # node server.mjs → http://0.0.0.0:3000
```

Deploy kahin bhi (static): `dist/` folder Netlify / Vercel / GitHub Pages / Cloudflare Pages pe
daal do — koi server, key ya env variable **nahi chahiye**. `server.mjs` sirf static serve +
SPA fallback ke liye hai.

Dev mode: `npm run dev` (Vite) · Engine self-test: `npm run selftest`

## 🗂️ Structure

```
web/src/engine/    core.js (rotation math) · adapters.js (providers) · engine.js (orchestrator)
                   images.js (image lanes) · persona.js (MOHAN brain prompt)
web/src/lib/       markdown · xlsx/pdf/files · voice (speech) · local store
web/src/ui/        ChatGPT-style React UI
server.mjs         tiny static server (zero deps)
scripts/selftest.mjs   rotation engine self-tests
```

## 🔒 Privacy

Chats sirf tumhare browser (localStorage) me rehte hain. Koi account nahi, MOHAN khud
kuch store nahi karta — providers ko sirf wahi text jaata hai jo tum bhejte ho.
