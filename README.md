# Mohan Order Creater

Chat-style PWA: PO (PDF / Excel / photo / text) → table **Code | Qty | PO Name**.

- Free Gemini API (key only in your browser — never in this repo)
- Master product list + saved rules (local)
- Works as GitHub Pages permanent link

## Permanent live (GitHub Pages) — 5 minutes

### A) Create repo on GitHub
1. Open https://github.com/new  
2. Repository name: `mohan-order-creater`  
3. Public → **Create repository** (do not add README if you will upload zip)

### B) Upload these files
Upload **everything in this folder** except you must **never** add any file that contains an API key.

Easiest: use the zip `mohan-order-creater-pages.zip` → extract → drag files into “uploading an existing file”.

Or with Git:
```bash
git clone https://github.com/YOUR_USER/mohan-order-creater.git
# copy all project files into the clone
git add .
git commit -m "Mohan Order Creater"
git push -u origin main
```

### C) Turn on Pages
1. Repo → **Settings** → **Pages**  
2. **Source**: GitHub Actions  
   (workflow file `.github/workflows/pages.yml` is already included)  
3. Wait 1–2 minutes → open the link:  
   `https://YOUR_USER.github.io/mohan-order-creater/`

Alternative without Actions: Settings → Pages → Deploy from branch → `main` / `/ (root)`.

### D) First open on phone/PC
1. Open the Pages link  
2. **Settings (⚙)** → paste Gemini API key → Save  
3. Send a PO and test  

Key stays on **that device only**. Other phone/PC = paste key again (or Export/Import rules).

## API key (later, free)
https://aistudio.google.com → Get API key  

## Local test
```bash
python3 -m http.server 8080
# http://localhost:8080
```

## Safety
- No secrets in git  
- `.gitignore` blocks `.env`  
- If key ever leaks: delete key in AI Studio and create new one  
