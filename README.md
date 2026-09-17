# Zernio Login + Patcher + TikTok Publish

1. Login with Zernio API key
2. Select MP4 → see Resolution / Size / Duration
3. Patch → Download and/or Publish to TikTok via Zernio

## After Patch

1. POST /api/zernio/presign → upload URL
2. Client PUTs patched file to Zernio storage
3. POST /api/zernio/publish → TikTok post

## Requirements

- TikTok account connected in Zernio dashboard
- SESSION_SECRET on Vercel
- Framework Other, Output Directory .

## Note

Browser cannot always read FPS from local files — Resolution, Size, Duration are shown.
