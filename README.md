# Zernio Login + Video Patcher

- Login with your **Zernio API key**
- Select an **MP4**, **Patch**, then **Download** as `[name]-1dleryu.mp4`
- No TikTok checker / no TikWM

## Deploy (Vercel)

1. Files at repo **root**
2. Framework: **Other** · Output Directory: **`.`**
3. Env:
   - `SESSION_SECRET` = long random string (required)
   - `MAINTENANCE_MODE` = `false`
4. Redeploy

## Update patch engine

Edit `engine.js` in GitHub → push → redeploy.  
Browser loads `/engine.js` and calls `window.IdleryuPatch.patch()`.
'''