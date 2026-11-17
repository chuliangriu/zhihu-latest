import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/catchall.mjs';
function response() {
  const headers = new Map();
  return { setHeader(name, value) { headers.set(name, value); }, getHeader(name) { return headers.get(name); },
    statusCode: 200, body: null, status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }, send(body) { this.body = body; return this; } };
}
test('Vercel catchall routes an unauthenticated identity request to the login service', async () => {
  const res = response();
  await handler({ url: '/api/auth-me', method: 'GET', headers: {}, query: {} }, res);
  assert.equal(res.statusCode, 401);
});
test('Vercel catchall preserves OAuth callback state validation', async () => {
  for (const request of [
    { headers: {}, query: {} },
    { headers: { cookie: 'wjr_oauth_state=expected' }, query: { state: 'different' } },
    { headers: { cookie: 'wjr_oauth_state=expected' }, query: {} },
  ]) {
    const res = response();
    await handler({ url: '/api/zhihu-callback', method: 'GET', ...request }, res);
    assert.equal(res.statusCode, 400);
    assert.match(res.body, /state/);
  }
});
