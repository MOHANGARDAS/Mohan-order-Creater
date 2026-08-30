# 🚀 MOHAN Deploy Runbook

Repo ka setup: **GitHub Pages = `main` branch / root (legacy source)**, aur repo root me
**pre-built static app** committed hai (`index.html` + `assets/`). Isliye deploy =
merge into `main` → Pages khud rebuild kar leta hai. **`npm run build` sirf tab chahiye
jab source (`web/`) badla ho.**

## Step 0 — State samjho

- Live URL: https://mohangardas.github.io/Mohan-order-Creater/
- Pages source: `main` / `/` (legacy) — `.nojekyll` committed hai
- Root `index.html` + `assets/*` = published build (hash-named files)
- Source code `web/` me hai (Vite + React)

## Normal deploy (source badla hai)

```bash
npm ci              # ya: npm install
npm run build       # → dist/
node scripts/selftest.mjs   # → "All MOHAN engine-core tests passed ✓"

# dist → repo root publish:
rm -rf assets && cp -r dist/assets assets && cp dist/index.html index.html

git checkout -b <feature-branch>
git add -A && git commit -m "vX: <changes>"
git push origin <feature-branch>
gh pr create --title "..." --body "..."
gh pr merge --merge
```

## Deploy verify (mandatory)

```bash
gh api repos/MOHANGARDAS/Mohan-order-Creater/pages/builds/latest --jq .status
# "building" → wait; "built" ho jaye to:
```

1. Live page kholo: https://mohangardas.github.io/Mohan-order-Creater/
2. Page ke source me jo JS bundle reference hai (e.g. `assets/index-XXXX.js`)
   wo **repo root `assets/` me exact naam se** hona chahiye — match = live build
   latest commit se aayi hai.

## Troubleshooting

| Problem | Fix |
|---|---|
| Pages "building" atka hai | `gh api .../pages/builds/latest` 1–2 min me dobara check karo |
| Live page purani bundle dikhaye | root `assets/` me naya hash file hai? nahi to build+publish step miss hua |
| `vite: not found` | `npm ci` re-run karo (node_modules git me nahi hai) |
| Merge conflict root `index.html`/`assets` | conflict accept karo **apne** (newer) build ka — root build hamesha latest source se banna chahiye |

⚠️ **Note:** agar kabhi `dist/` symlink ho to build se PEHLE hatao
(`rm dist`) — vite `emptyOutDir: true` out-dir ko khali karta hai.
