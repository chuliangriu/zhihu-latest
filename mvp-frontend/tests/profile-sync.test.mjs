import test from 'node:test';
import assert from 'node:assert/strict';
import { createLiveController } from '../public/mvp-live.js';
import { entryView } from '../public/mvp-entry.js';
import { createApi, ApiError } from '../public/mvp-api.js';
const session = { success: true, user: { id: 'current-user', display_name: '测试用户', avatar_url: null } };
const ready = { status: 'ready', profile: { role: '近期背景', impression: ['用户自己的近期背景'], recentFocus: '用户持续关注的事情' } };
function harness(profiles) {
  let html = '', syncCalls = 0;
  const fetcher = async (path, options) => {
    if (path === '/api/auth-me') return Response.json(session);
    assert.equal(path, '/api/profile/summary');
    assert.equal(options.credentials, 'same-origin');
    assert.deepEqual(JSON.parse(options.body), { useAuthorizedFootprints: true });
    const profile = profiles[syncCalls++];
    return profile instanceof Response ? profile : Response.json({ success: true, data: profile });
  };
  const c = createLiveController({ api: createApi(fetcher), render: state => { html = entryView(state); } });
  c.initialize();
  return { c, get html() { return html; }, get syncCalls() { return syncCalls; } };
}
test('model failure preserves footprint progress and can retry without logging out', async () => {
  const h = harness([Response.json({ success: false, data: { status: 'unavailable', reasonCode: 'LLM_HTTP_401', coverage: { creations: 1, collections: 2 }, profile: null } }, { status: 503 }), ready]);
  await h.c.action('start');
  assert.equal(h.c.getState().sessionReady, true);
  assert.equal(h.c.getState().user.name, '测试用户');
  assert.equal(h.c.getState().user.profileReady, false);
  assert.equal(h.c.getState().profileIssueCode, 'LLM_HTTP_401');
  assert.match(h.html, /已读取你的知乎足迹/);
  assert.match(h.html, /data-action="retry-profile"/);
  assert.doesNotMatch(h.html, /重新登录知乎|API Key|LLM_HTTP_401/);
  await h.c.action('retry-profile');
  assert.equal(h.syncCalls, 2);
  assert.equal(h.c.getState().user.profileReady, true);
  assert.match(h.html, /用户自己的近期背景/);
  assert.doesNotMatch(h.html, /重新同步背景|暂时无法整理背景/);
});
test('expired authorization asks for a fresh login on the existing site', async () => {
  const h = harness([Response.json({ success: false, data: { status: 'unavailable', reasonCode: 'OAUTH_REAUTH_REQUIRED', profile: null } }, { status: 503 })]);
  await h.c.action('start');
  assert.equal(h.c.getState().sessionReady, true);
  assert.match(h.html, /知乎授权已失效/);
  assert.ok(h.html.includes('href="/api/zhihu-login"'));
  assert.doesNotMatch(h.html, /data-action="retry-profile"/);
});
test('missing backend integration is visible instead of a silent placeholder', async () => {
  const h = harness([Response.json({ error: { code: 'PROFILE_NOT_CONNECTED' } }, { status: 503 })]);
  await h.c.action('start');
  assert.match(h.html, /背景同步服务暂未启用/);
  assert.match(h.html, /data-action="open-profile"/);
  assert.equal(h.c.getState().busy, false);
});
test('insufficient footprints does not pretend the profile synchronized; manual recovery clears notice', async () => {
  const h = harness([{ status: 'needs_input', reasonCode: 'insufficient_footprints', profile: null, coverage: { creations: 0, collections: 0 } }]);
  await h.c.action('start');
  assert.match(h.html, /近期可用的公开创作和收藏不足/);
  assert.equal(h.c.getState().user.profileReady, false);
  h.c.input('profileDraft', '【有限背景】\n这是我愿意介绍的近期背景。');
  await h.c.action('save-profile');
  assert.equal(h.c.getState().profileNotice, '');
  assert.equal(h.c.getState().user.profileReady, true);
  assert.doesNotMatch(h.html, /公开创作和收藏不足/);
});
test('API failure retains only code and counts, never footprint text or tokens', async () => {
  const api = createApi(async () => Response.json({ success: false, data: { reasonCode: 'OAUTH_TOKEN_UNAVAILABLE', coverage: { creations: 0, collections: 0 }, access_token: 'secret-test-token', raw: 'private-test-content' } }, { status: 503 }));
  await assert.rejects(() => api.json('/api/profile/summary', { useAuthorizedFootprints: true }), error => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.code, 'OAUTH_TOKEN_UNAVAILABLE');
    assert.deepEqual(error.coverage, { creations: 0, collections: 0 });
    assert.doesNotMatch(JSON.stringify(error), /secret-test-token|private-test-content/);
    return true;
  });
});

test('partial frequency failure preserves progress and blocks retries during Retry-After', async () => {
  const actualNow=Date.now; let now=actualNow(); Date.now=()=>now;
  try {
    const h=harness([Response.json({success:false,data:{status:'unavailable',reasonCode:'ZHIHU_RATE_LIMITED',coverage:{creations:3,collections:0},sources:{creation:'read',collection:'failed'}}},{status:503,headers:{'Retry-After':'60'}}),ready]);
    await h.c.action('start');
    assert.match(h.html,/已读取创作中的 3 条可用资料，收藏暂未读取/);assert.match(h.html,/频率限制/);
    assert.match(h.html,/data-action="retry-profile" disabled/);assert.doesNotMatch(h.html,/知乎授权已失效|公开创作和收藏不足/);
    await h.c.action('retry-profile');assert.equal(h.syncCalls,1);
    now+=60001;await h.c.action('retry-profile');assert.equal(h.syncCalls,2);assert.equal(h.c.getState().user.profileReady,true);
  } finally {Date.now=actualNow;}
});
test('quota exhaustion does not claim a reset time or ask for login', async () => {
  const h=harness([Response.json({success:false,data:{status:'unavailable',reasonCode:'ZHIHU_QUOTA_EXCEEDED',retryAfterSeconds:900}},{status:503})]);
  await h.c.action('start');assert.match(h.html,/可用额度已耗尽/);assert.match(h.html,/恢复时间以知乎为准/);assert.doesNotMatch(h.html,/频率限制|明天恢复|知乎授权已失效/);
  await h.c.action('retry-profile');assert.equal(h.syncCalls,1);
});
test('server credential rejection does not ask users to log in again', async () => {
  const h=harness([Response.json({success:false,data:{status:'unavailable',reasonCode:'ZHIHU_ACCESS_SECRET_REJECTED'}},{status:503})]);
  await h.c.action('start');assert.match(h.html,/连接配置暂不可用/);assert.doesNotMatch(h.html,/重新登录知乎/);
});
