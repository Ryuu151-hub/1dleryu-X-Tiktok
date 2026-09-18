/**
 * POST /api/zernio-presign
 * Body: { filename, contentType, size? }
 * Returns { uploadUrl, publicUrl } from Zernio using the user's API key.
 */
import { getSessionWithKey } from './_lib/session.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const auth = getSessionWithKey(req);
  if (!auth || !auth.apiKey) {
    return res.status(401).json({ ok: false, error: 'Login required', code: 'UNAUTHORIZED' });
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

  const filename = String(body.filename || 'video.mp4').trim();
  const contentType = String(body.contentType || 'video/mp4').trim();
  const size = body.size != null ? Number(body.size) : undefined;

  const reqBody = { filename, contentType };
  if (size && size > 0) reqBody.size = size;

  try {
    const r = await fetch('https://zernio.com/api/v1/media/presign', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${auth.apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(reqBody),
    });

    const text = await r.text();
    let json = {};
    try {
      json = JSON.parse(text);
    } catch {
      return res.status(502).json({ ok: false, error: 'Invalid presign response' });
    }

    if (!r.ok) {
      return res.status(r.status).json({
        ok: false,
        error: json.error || json.message || 'Presign failed',
        details: json,
      });
    }

    // Shape: { uploadUrl, publicUrl } or nested under data
    const data = json.data || json;
    const uploadUrl = data.uploadUrl || data.upload_url;
    const publicUrl = data.publicUrl || data.public_url;

    if (!uploadUrl || !publicUrl) {
      return res.status(502).json({
        ok: false,
        error: 'Presign response missing uploadUrl/publicUrl',
        details: json,
      });
    }

    return res.status(200).json({ ok: true, uploadUrl, publicUrl });
  } catch (err) {
    return res.status(502).json({ ok: false, error: err.message || 'Presign failed' });
  }
}
