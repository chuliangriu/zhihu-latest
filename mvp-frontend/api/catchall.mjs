import backend from './backend.mjs';
import authMe from './auth-me.mjs';
import login from './zhihu-login.mjs';
import callback from './zhihu-callback.mjs';
import logout from './logout.mjs';
import health from './health.mjs';
const handlers = new Map([
  ['/api/auth-me', authMe], ['/api/zhihu-login', login],
  ['/api/zhihu-callback', callback], ['/api/logout', logout], ['/api/health', health],
]);
export default function handler(request, response) {
  const pathname = new URL(request.url, 'https://localhost').pathname;
  return (handlers.get(pathname) ?? backend)(request, response);
}
