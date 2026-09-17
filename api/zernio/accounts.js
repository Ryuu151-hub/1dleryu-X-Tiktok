/**
 * GET /api/zernio/accounts
 * Lists connected accounts (for TikTok picker) using the logged-in user's key.
 */
import { getSessionWithKey } from '../_lib/session.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const auth = getSessionWithKey(req);
  if (!auth || !auth.apiKey) {
    return res.status(401).json({ ok: false, error: 'Login required', code: 'UNAUTHORIZED' });
  }

  try {
    const r = await fetch('https://zernio.com/api/v1/accounts', {
      headers: {
        Authorization: `Bearer ${auth.apiKey}`,
        Accept: 'application/json',
      },
    });
    const text = await r.text();
    let json = {};
    try {
      json = JSON.parse(text);
    } catch {
      return res.status(502).json({ ok: false, error: 'Invalid response from Zernio' });
    }

    if (!r.ok) {
      return res.status(r.status).json({
        ok: false,
        error: json.error || json.message || 'Failed to list accounts',
      });
    }

    // Normalize list — shape may be { accounts: [] } or { data: [] }
    const list = json.accounts || json.data || json || [];
    const arr = Array.isArray(list) ? list : [];

    const accounts = arr.map((a) => ({
      id: a._id || a.id || a.accountId,
      platform: a.platform || a.provider || '',
      username: a.username || a.handle || a.name || a.displayName || '',
      displayName: a.displayName || a.name || a.username || '',
    }));

    const tiktok = accounts.filter((a) => String(a.platform).toLowerCase() === 'tiktok');

    return res.status(200).json({
      ok: true,
      accounts,
      tiktokAccounts: tiktok,
    });
  } catch (err) {
    return res.status(502).json({ ok: false, error: err.message || 'Zernio request failed' });
  }
}
