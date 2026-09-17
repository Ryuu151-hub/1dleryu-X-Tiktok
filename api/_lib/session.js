/**
 * Lightweight signed session cookie (no external deps).
 * Cookie name: zt_session
 * Payload: { uid, authType, exp }  — Zernio key is NOT stored in the cookie.
 * For later Zernio API calls as the user, store the key encrypted server-side
 * or re-ask; this login only gates access to your app.
 */
import { createHmac, timingSafeEqual, randomBytes } from 'crypto';

const COOKIE = 'zt_session';
const MAX_AGE_SEC = 60 * 60 * 24 * 7; // 7 days

function secret() {
  const s = process.env.SESSION_SECRET || '';
  if (s.length < 16) {
    // Fallback for local only — set SESSION_SECRET in production
    return 'dev-only-insecure-secret-change-me';
  }
  return s;
}

function b64url(buf) {
  return Buffer.from(buf)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function fromB64url(str) {
  const pad = str.length % 4 === 0 ? '' : '='.repeat(4 - (str.length % 4));
  const s = str.replace(/-/g, '+').replace(/_/g, '/') + pad;
  return Buffer.from(s, 'base64');
}

function sign(payloadObj) {
  const payload = b64url(JSON.stringify(payloadObj));
  const sig = createHmac('sha256', secret()).update(payload).digest();
  return `${payload}.${b64url(sig)}`;
}

function verify(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const expected = createHmac('sha256', secret()).update(payload).digest();
  let got;
  try {
    got = fromB64url(sig);
  } catch {
    return null;
  }
  if (got.length !== expected.length || !timingSafeEqual(got, expected)) return null;
  try {
    const data = JSON.parse(fromB64url(payload).toString('utf8'));
    if (!data.exp || Date.now() > data.exp) return null;
    return data;
  } catch {
    return null;
  }
}

export function parseCookies(req) {
  const header = req.headers.cookie || '';
  const out = {};
  header.split(';').forEach((part) => {
    const i = part.indexOf('=');
    if (i === -1) return;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    out[k] = decodeURIComponent(v);
  });
  return out;
}

export function getSession(req) {
  const cookies = parseCookies(req);
  return verify(cookies[COOKIE]);
}

export function setSessionCookie(res, sessionData) {
  const exp = Date.now() + MAX_AGE_SEC * 1000;
  const token = sign({ ...sessionData, exp });
  const secure = process.env.NODE_ENV === 'production' || process.env.VERCEL === '1';
  const parts = [
    `${COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    `Max-Age=${MAX_AGE_SEC}`,
    'HttpOnly',
    'SameSite=Lax',
  ];
  if (secure) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

export function clearSessionCookie(res) {
  const secure = process.env.NODE_ENV === 'production' || process.env.VERCEL === '1';
  const parts = [
    `${COOKIE}=`,
    'Path=/',
    'Max-Age=0',
    'HttpOnly',
    'SameSite=Lax',
  ];
  if (secure) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

export function requireSession(req, res) {
  const session = getSession(req);
  if (!session) {
    res.status(401).json({ ok: false, error: 'Login required', code: 'UNAUTHORIZED' });
    return null;
  }
  return session;
}

export { COOKIE, MAX_AGE_SEC };
    
