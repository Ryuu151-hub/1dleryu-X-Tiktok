/**
 * GET /api/config
 * Returns site config. Controlled via Vercel env vars (no redeploy of HTML needed for maintenance).
 *
 * Env:
 *   MAINTENANCE_MODE=true|false   (default: true)
 *   MAINTENANCE_MESSAGE=...       optional custom message
 *   ENGINE_VERSION=...            optional label shown in UI
 */
export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  const maintenance =
    String(process.env.MAINTENANCE_MODE ?? 'true').toLowerCase() === 'true';

  res.status(200).json({
    maintenance,
    message:
      process.env.MAINTENANCE_MESSAGE ||
      'This website is in maintenance mode. Please check back later.',
    engineVersion: process.env.ENGINE_VERSION || '4.9',
    features: {
      patcher: !maintenance,
      tiktokChecker: !maintenance,
    },
  });
}
