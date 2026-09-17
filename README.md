# Idleryu X TikTok (Vercel)

Frontend: MP4 patcher + TikTok video checker  
Backend: Vercel serverless (`/api/*`) keeps your TikWM key private.

## Project layout

```
index.html          → main UI (Patcher + TikTok Check tabs)
engine.js           → MP4 patch engine (edit this file to change patching logic)
api/config.js       → maintenance mode + feature flags
api/check-tiktok.js → TikWM proxy (uses TIKWM_API_KEY)
vercel.json
package.json
```

## Deploy to Vercel

1. Push this folder to a **GitHub repository**.
2. In [vercel.com](https://vercel.com) → **Add New Project** → import that repo.
3. Set **Environment Variables**:

| Name | Example | Notes |
|------|---------|--------|
| `MAINTENANCE_MODE` | `true` | Site shows maintenance page until you set `false` |
| `MAINTENANCE_MESSAGE` | `This website is in maintenance mode…` | Optional |
| `TIKWM_API_KEY` | `your_key` | **Required** for TikTok Check |
| `TIKWM_BASE_URL` | `https://api.tikwmapi.com` | Or `https://tikwm.com/api` for free public API |
| `ENGINE_VERSION` | `4.9` | Optional label |

4. Deploy. Open the site — you should see **Maintenance Mode**.
5. When ready: set `MAINTENANCE_MODE=false` in Vercel → **Redeploy** (or wait for next deploy). Site unlocks.

## Change the patch engine via GitHub

1. Edit **`engine.js`** in the GitHub repo (the `patch()` function and helpers).
2. Commit to `main` (or your production branch).
3. Vercel auto-redeploys → new engine is live.

No need to touch `index.html` for engine-only changes.

## TikTok Checker fields

| Section | Fields |
|---------|--------|
| Information | ID Video, Date, Region Upload, Shadow Ban* |
| Statistics | Views, Likes, Comments, Favorites, Shares, Downloads |
| Quality | Resolution, FPS, Bitrate, Duration, Size, Format |

\* Shadow Ban is a **heuristic** (not an official TikTok signal). TikWM does not expose a real shadow-ban flag. Resolution / FPS / Bitrate are often unavailable from TikWM and show as `—`.

## Local test

```bash
npm i -g vercel
vercel dev
```

Set env vars in the Vercel dashboard or a local `.env` for `vercel dev`.

## Security

- Never put `TIKWM_API_KEY` in `index.html` or client JS.
- Only `/api/check-tiktok` talks to TikWM; the browser only calls your own API.
'''