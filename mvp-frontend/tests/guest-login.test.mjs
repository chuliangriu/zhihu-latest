import test from 'node:test';
import assert from 'node:assert/strict';
import { createLiveController } from '../public/mvp-live.js';
import { createApi } from '../public/mvp-api.js';
import { consumeLoginReturn } from '../public/mvp-auth.js';
import { entryView } from '../public/mvp-entry.js';
import authMe from '../api/auth-me.mjs';

const session = { success: true, user: { id: 'new-visitor', display_name: '新用户' } };
const ready = { status: 'ready', profile: { role: '近期背景', impression: ['用户授权的近期背景'], recentFocus: '持续关注的事情' } };
function harness(authResponse) {
  const calls = [], navigations = [];
  let html = '';
  const api = createApi(async path => {
    calls.push(path);
    if (path === '/api/auth-me') return authResponse();
    assert.equal(path, '/api/profile/summary');
    return Response.json({ success: true, data: ready });
  });
  const c = createLiveController({ api, navigate: url => navigations.push(url), render: state => { html = entryView(state); } });
  return { c, calls, navigations, get html() { return html; } };
}
async function realGuestResponse() {
  // Exercise the actual deployed auth handler with a fresh browser (no cookie, no database calls).
  let status = 200, body;
  const res = { setHeader() {}, status(code) { status = code; return this; }, json(value) { body = value; } };
  await authMe({ method: 'GET', headers: {} }, res);
  return Response.json(body, { status });
}

test('fresh browser enters same-window OAuth on its first start click and retains a fallback link', async () => {
  const h = harness(realGuestResponse);
  h.c.initialize();
  assert.deepEqual(h.calls, []);
  await h.c.action('start');
  assert.deepEqual(h.calls, ['/api/auth-me']);
  assert.deepEqual(h.navigations, ['/api/zhihu-login']);
  assert.equal(h.c.getState().sessionReady, false);
  assert.equal(h.c.getState().authRequired, true);
  assert.match(h.html, /href="\/api\/zhihu-login"/);
  assert.doesNotMatch(h.html, /用户授权的近期背景/);
});

test('valid sessions synchronize background without unnecessary OAuth', async () => {
  const h = harness(() => Response.json(session));
  await h.c.action('start');
  assert.deepEqual(h.calls, ['/api/auth-me', '/api/profile/summary']);
  assert.deepEqual(h.navigations, []);
  assert.equal(h.c.getState().user.profileReady, true);
});

test('session outages, forbidden responses, malformed payloads and network errors never trigger OAuth', async () => {
  for (const response of [
    () => Response.json({ error: 'SESSION_STORE_UNAVAILABLE' }, { status: 503 }),
    () => Response.json({ error: 'FORBIDDEN' }, { status: 403 }),
    () => Response.json({ success: true, user: {} }),
    () => { throw new TypeError('Failed to fetch'); },
    () => Response.json({ error: 'NOT_LOGGED_IN_LOOKUP_FAILED' }, { status: 503 }),
  ]) {
    const h = harness(response);
    await h.c.action('start');
    assert.deepEqual(h.calls, ['/api/auth-me']);
    assert.deepEqual(h.navigations, []);
    assert.equal(h.c.getState().authRequired, false);
    assert.ok(h.c.getState().error);
  }
});

test('OAuth return verifies its session then synchronizes without another homepage click', async () => {
  const h = harness(() => Response.json(session));
  await h.c.initialize({ loginReturn: true });
  assert.deepEqual(h.calls, ['/api/auth-me', '/api/profile/summary']);
  assert.deepEqual(h.navigations, []);
  assert.equal(h.c.getState().screen, 'login');
  assert.equal(h.c.getState().sessionReady, true);
  assert.match(h.html, /用户授权的近期背景/);
});

test('a forged or stale success marker cannot authenticate or cause an OAuth redirect loop', async () => {
  const h = harness(realGuestResponse);
  await h.c.initialize({ loginReturn: true });
  assert.deepEqual(h.calls, ['/api/auth-me']);
  assert.deepEqual(h.navigations, []);
  assert.equal(h.c.getState().sessionReady, false);
  assert.match(h.html, /暂未确认登录成功/);
  assert.match(h.html, /href="\/api\/zhihu-login"/);
});

test('a rejected browser navigation keeps a visible manual login recovery', async () => {
  let html = '';
  const c = createLiveController({ api: createApi(realGuestResponse), navigate: () => { throw Error('blocked'); }, render: s => { html = entryView(s); } });
  await c.action('start');
  assert.match(html, /未能打开知乎登录/);
  assert.match(html, /href="\/api\/zhihu-login"/);
  assert.equal(c.getState().busy, false);
});

test('duplicate entry clicks while checking the session do not start multiple authorizations', async () => {
  let finish;
  const h = harness(() => new Promise(resolve => { finish = resolve; }));
  const first = h.c.action('start');
  await h.c.action('start');
  finish(await realGuestResponse());
  await first;
  assert.deepEqual(h.calls, ['/api/auth-me']);
  assert.deepEqual(h.navigations, ['/api/zhihu-login']);
});

test('the one-time return marker is removed while preserving unrelated query and hash state', () => {
  const replacements = [];
  const history = { state: { existing: true }, replaceState: (...args) => replacements.push(args) };
  assert.equal(consumeLoginReturn({ href: 'https://app.example/?login=success&from=friend#mailbox' }, history), true);
  assert.deepEqual(replacements, [[{ existing: true }, '', '/?from=friend#mailbox']]);
  assert.equal(consumeLoginReturn({ href: 'https://app.example/' }, history), false);
  assert.equal(consumeLoginReturn({ href: 'https://app.example/?login=failed' }, history), false);
  assert.equal(replacements.length, 1);
});
