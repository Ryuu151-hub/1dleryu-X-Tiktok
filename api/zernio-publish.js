/**
 * POST /api/zernio-publish
 * Body: multipart or JSON with base64 is too heavy — use multipart file + fields.
 *
 * For Vercel: accept JSON with { accountId, content, publishNow } and a separate
 * flow: client uploads via presign proxy.
 *
 * This endpoint expects:
 *   Content-Type: application/json
 *   { accountId, content, publishNow?, publicUrl }
 *
 * Prefer: client calls /api/zernio/presign first, PUTs file to Zernio, then this.
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

  const accountId = String(body.accountId || '').trim();
  const publicUrl = String(body.publicUrl || '').trim();
  const content = String(body.content || '').trim();
  const publishNow = body.publishNow !== false;

  if (!accountId) {
    return res.status(400).json({ ok: false, error: 'accountId is required' });
  }
  if (!publicUrl || !/^https:\/\//i.test(publicUrl)) {
    return res.status(400).json({ ok: false, error: 'publicUrl (https) is required' });
  }

  const payload = {
    content: content || ' ',
    mediaItems: [{ type: 'video', url: publicUrl }],
    platforms: [{ platform: 'tiktok', accountId }],
    tiktokSettings: {
      privacy_level: body.privacy || 'PUBLIC_TO_EVERYONE',
      allow_comment: body.allowComment !== false,
      allow_duet: body.allowDuet !== false,
      allow_stitch: body.allowStitch !== false,
      content_preview_confirmed: true,
      express_consent_given: true,
    },
    publishNow: !!publishNow,
  };

  if (!publishNow && body.scheduledFor) {
    payload.scheduledFor = body.scheduledFor;
    payload.timezone = body.timezone || 'UTC';
    delete payload.publishNow;
  }

  try {
    const r = await fetch('https://zernio.com/api/v1/posts', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${auth.apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const text = await r.text();
    let json = {};
    try {
      json = JSON.parse(text);
    } catch {
      return res.status(502).json({
        ok: false,
        error: 'Invalid response from Zernio',
        raw: text.slice(0, 300),
      });
    }

    if (!r.ok) {
      return res.status(r.status).json({
        ok: false,
        error: json.error || json.message || 'Publish failed',
        details: json,
      });
    }

    const post = json.post || json.data || json;
    return res.status(200).json({
      ok: true,
      message: json.message || 'Post created',
      postId: post._id || post.id || null,
      status: post.status || null,
      post,
    });
  } catch (err) {
    return res.status(502).json({ ok: false, error: err.message || 'Publish failed' });
  }
}
