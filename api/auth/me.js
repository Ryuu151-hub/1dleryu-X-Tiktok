import { getSession } from '../_lib/session.js';

export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const session = getSession(req);
  if (!session) {
    return res.status(200).json({ ok: true, loggedIn: false });
  }

  return res.status(200).json({
    ok: true,
    loggedIn: true,
    user: {
      userId: session.uid,
      authType: session.authType,
      keyHint: session.keyHint || null,
    },
  });
}
