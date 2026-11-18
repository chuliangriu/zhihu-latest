import { createHash, randomBytes } from 'node:crypto';
import { supabaseRequest } from './supabase.mjs';

export const SESSION_COOKIE = 'wjr_session';
export const OAUTH_STATE_COOKIE = 'wjr_oauth_state';
const SESSION_SECONDS = 7 * 24 * 60 * 60;

export function randomToken() {
  return randomBytes(32).toString('base64url');
}

export function hashToken(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function readCookie(request, name) {
  const cookieHeader = request.headers.cookie || '';
  let found = ''; let count = 0;
  for (const part of cookieHeader.split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) {
      count++;
      try { found = decodeURIComponent(value.join('=')); } catch { return ''; }
    }
  }
  return count === 1 ? found : '';
}

export function preventAuthCaching(response) {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Pragma', 'no-cache');
  response.setHeader('Referrer-Policy', 'no-referrer');
}

export function setCookie(response, name, value, maxAgeSeconds) {
  appendCookie(
    response,
    `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSeconds}`
  );
}

export function clearCookie(response, name) {
  appendCookie(response, `${name}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);
}

function appendCookie(response, cookie) {
  const current = response.getHeader('Set-Cookie');
  const values = current ? (Array.isArray(current) ? current : [current]) : [];
  response.setHeader('Set-Cookie', [...values, cookie]);
}

export async function createSession(userId, response) {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + SESSION_SECONDS * 1000).toISOString();
  const result = await supabaseRequest('app_sessions', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: { user_id: userId, session_hash: hashToken(token), expires_at: expiresAt },
  });
  if (!result.ok) throw new Error(`创建登录会话失败（HTTP ${result.status}）`);
  setCookie(response, SESSION_COOKIE, token, SESSION_SECONDS);
}

export async function requireUser(request) {
  const token = readCookie(request, SESSION_COOKIE);
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const now = encodeURIComponent(new Date().toISOString());
  const sessionHash = encodeURIComponent(hashToken(token));
  const sessions = await supabaseRequest(
    `app_sessions?session_hash=eq.${sessionHash}&revoked_at=is.null&expires_at=gt.${now}&select=id,user_id,expires_at,revoked_at&limit=1`
  );
  if (!sessions.ok) throw new Error('SESSION_STORE_UNAVAILABLE');
  if (!Array.isArray(sessions.data) || !sessions.data[0]) return null;

  const session = sessions.data[0];
  if (!validUuid(session.id) || !validUuid(session.user_id) || session.revoked_at !== null ||
      !Number.isFinite(Date.parse(session.expires_at)) || Date.parse(session.expires_at) <= Date.now()) return null;
  const users = await supabaseRequest(
    `users?id=eq.${encodeURIComponent(session.user_id)}&select=id,zhihu_user_id,display_name,avatar_url,profile_url,created_at&limit=1`
  );
  if (!users.ok) throw new Error('SESSION_STORE_UNAVAILABLE');
  if (!Array.isArray(users.data) || !users.data[0] || users.data[0].id !== session.user_id) return null;
  const { zhihu_user_id: identityKey, ...user } = users.data[0];
  return { sessionId: session.id, identityKey, user };
}

export async function revokeSession(request) {
  const token = readCookie(request, SESSION_COOKIE);
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return;
  const result = await supabaseRequest(`app_sessions?session_hash=eq.${encodeURIComponent(hashToken(token))}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: { revoked_at: new Date().toISOString() },
  });
  if (!result.ok) throw new Error('SESSION_REVOCATION_FAILED');
}

function validUuid(value) {
  return typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);
}
