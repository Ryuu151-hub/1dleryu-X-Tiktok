/**
 * Signed session cookie + encrypted Zernio API key (for publish as the user).
 * Cookie: zt_session
 */
import { createHmac, timingSafeEqual, createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';

const COOKIE = 'zt_session';
const MAX_AGE_SEC = 60 * 60 * 24 * 7;

function secret() {
  const s = process.env.SESSION_SECRET || '';
  if (s.length < 16) return 'dev-only-insecure-secret-change-me';
  return s;
}

function keyMaterial() {
  return scryptSync(secret(), 'zt-session-v1', 32);
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

export function encryptKey(plain) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyMaterial(), iv);
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return b64url(Buffer.concat([iv, tag, enc]));
}

export function decryptKey(blob) {
  if (!blob) return null;
  try {
    const buf = fromB64url(blob);
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const data = buf.subarray(28);
    const decipher = createDecipheriv('aes-256-gcm', keyMaterial(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
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

/** Session + decrypted Zernio API key (or null). */
export function getSessionWithKey(req) {
  const session = getSession(req);
  if (!session) return null;
  const apiKey = decryptKey(session.ek) || null;
  return { session, apiKey };
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
  const parts = [`${COOKIE}=`, 'Path=/', 'Max-Age=0', 'HttpOnly', 'SameSite=Lax'];
  if (secure) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

export { COOKIE, MAX_AGE_SEC };
                           
