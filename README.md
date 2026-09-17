# Zernio Login App

Website with **Zernio API-key login only**.  
No TikTok checker. No TikWM.

## Features

- Login with user’s own Zernio key (`sk_…`)
- Verified via `GET https://zernio.com/api/v1/auth/verify`
- HttpOnly session cookie (key not stored in cookie)
- Logout
- Maintenance mode

## Structure

```
zernio-login-app/
├── index.html
├── api/
│   ├── auth/login.js
│   ├── auth/logout.js
│   ├── auth/me.js
│   ├── config.js
│   └── _lib/session.js
├── package.json
├── vercel.json
└── .env.example
```

## Vercel env vars

| Variable | Required |
|----------|----------|
| `SESSION_SECRET` | **Yes** (32+ random chars) |
| `MAINTENANCE_MODE` | No (`false`) |
| `MAINTENANCE_MESSAGE` | No |

## Deploy

1. Files at repo **root**
2. Framework: **Other**
3. Output Directory: **`.`**
4. Set `SESSION_SECRET` → Deploy
'''
