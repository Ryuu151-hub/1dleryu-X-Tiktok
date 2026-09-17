import { setSessionCookie, encryptKey } from '../_lib/session.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      return res.status(400).json({ ok: false, error: 'Invalid JSON' });
    }
  }
  body = body || {};

  const apiKey = String(body.apiKey || body.key || '').trim();
  if (!apiKey) {
    return res.status(400).json({ ok: false, error: 'API key is required' });
  }
  if (!apiKey.startsWith('sk_') || apiKey.length < 20) {
    return res.status(400).json({
      ok: false,
      error: 'Invalid key format. Zernio keys look like sk_…',
    });
  }

  try {
    const verify = await fetch('https://zernio.com/api/v1/auth/verify', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
      },
    });

    const text = await verify.text();
    let json = {};
    try {
      json = JSON.parse(text);
    } catch {
      /* ignore */
    }

    if (!verify.ok) {
      return res.status(401).json({
        ok: false,
        error: json.error || json.message || 'Invalid or expired Zernio API key',
        status: verify.status,
      });
    }

    if (json.valid === false) {
      return res.status(401).json({ ok: false, error: 'API key is not valid' });
    }

    const userId = json.userId || json.user_id || 'unknown';
    const authType = json.authType || json.auth_type || 'api_key';

    setSessionCookie(res, {
      uid: String(userId),
      authType: String(authType),
      keyHint: apiKey.slice(0, 6) + '…' + apiKey.slice(-4),
      ek: encryptKey(apiKey),
    });

    return res.status(200).json({
      ok: true,
      user: {
        userId: String(userId),
        authType: String(authType),
        keyHint: apiKey.slice(0, 6) + '…' + apiKey.slice(-4),
      },
    });
  } catch (err) {
    return res.status(502).json({
      ok: false,
      error: err.message || 'Could not reach Zernio',
    });
  }
}
