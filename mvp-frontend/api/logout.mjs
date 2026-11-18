import { SESSION_COOKIE, clearCookie, revokeSession, preventAuthCaching } from '../server/auth.mjs';

export default async function handler(request, response) {
  preventAuthCaching(response);
  if (request.method !== 'POST') return response.status(405).json({ success: false });
  const origin = process.env.SITE_URL;
  let expected;
  try { expected = new URL(origin).origin; } catch { return response.status(503).json({ success: false, error: 'SITE_URL_UNAVAILABLE' }); }
  if (request.headers.origin !== expected || request.headers['sec-fetch-site'] === 'cross-site') {
    return response.status(403).json({ success: false, error: 'ORIGIN_FORBIDDEN' });
  }
  try {
    await revokeSession(request);
    clearCookie(response, SESSION_COOKIE);
    return response.status(200).json({ success: true });
  } catch {
    return response.status(503).json({ success: false, error: 'SESSION_REVOCATION_FAILED' });
  }
}
