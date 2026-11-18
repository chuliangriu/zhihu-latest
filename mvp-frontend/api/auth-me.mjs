import { requireUser, preventAuthCaching } from '../server/auth.mjs';

export default async function handler(request, response) {
  preventAuthCaching(response);
  if (request.method !== 'GET') return response.status(405).json({ success: false });
  let auth;
  try { auth = await requireUser(request); }
  catch { return response.status(503).json({ success: false, error: 'SESSION_STORE_UNAVAILABLE' }); }
  if (!auth) return response.status(401).json({ success: false, error: 'NOT_LOGGED_IN' });
  response.setHeader('Cache-Control', 'no-store');
  return response.status(200).json({ success: true, user: auth.user });
}
