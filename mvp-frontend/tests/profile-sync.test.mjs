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
  assert.doesNotMatch(h.c.getState().profileNotice, /重新登录知乎|API Key|LLM_HTTP_401/);
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
  assert.match(h.html, /共 0 条，尚不足 2 条/);
  assert.equal(h.c.getState().user.profileReady, false);
  h.c.input('profileDraft', '【有限背景】\n这是我愿意介绍的近期背景。');
  await h.c.action('save-profile');
  assert.equal(h.c.getState().profileNotice, '');
  assert.equal(h.c.getState().user.profileReady, true);
  assert.doesNotMatch(h.html, /尚不足 2 条/);
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

test('model evidence shortage and incomplete generation have different recovery messages',async()=>{
 const h=harness([{status:'needs_input',reasonCode:'profile_insufficient_evidence',coverage:{creations:2,collections:1}},{status:'unavailable',reasonCode:'profile_output_incomplete',coverage:{creations:2,collections:1}}]);
 await h.c.action('start');assert.match(h.html,/已读取足够数量/);assert.doesNotMatch(h.html,/尚不足 2 条/);
 await h.c.action('retry-profile');assert.match(h.html,/这次背景整理不完整/);assert.doesNotMatch(h.html,/尚不足 2 条/);
});
test('account changes clear previous private profile, conversations, candidates and drafts',async()=>{
 let account='user-one',reads=0;
 const c=createLiveController({render:()=>{},api:{async json(path){if(path==='/api/auth-me')return{success:true,user:{id:account}};reads++;return ready;}}});
 await c.action('start');const state=c.getState();
 Object.assign(state,{conversationId:'old-conversation',discoveryId:'old-discovery',paper:{id:'old-paper'},activePapers:[{}],paperEdit:{quote:'old-private-quote'},profileDraft:'old-background',privateDraft:'old-message',publicReplies:[{}]});
 state.user.chat=[{role:'user',text:'old-private-chat'}];state.user.candidates={A:{quote:'old-candidate'}};state.user.sharePaper={quote:'old-paper'};
 account='user-two';await c.action('start');assert.equal(reads,2);assert.equal(state.user.id,'user-two');
 assert.equal(state.conversationId,null);assert.equal(state.discoveryId,null);assert.deepEqual(state.user.chat,[]);assert.deepEqual(state.user.candidates,{});assert.deepEqual(state.user.sharePaper,{});assert.equal(state.profileDraft,'');assert.equal(state.privateDraft,'');assert.equal(state.paperEdit,null);assert.deepEqual(state.activePapers,[]);
});
test('expired site sessions clear old private data and logout clears the current page',async()=>{
 let expired=false;const c=createLiveController({render:()=>{},api:{async json(path){if(path==='/api/logout')return{success:true};if(path==='/api/auth-me'){if(expired)throw new Error('NOT_LOGGED_IN');return session;}return ready;}}});
 await c.action('start');c.getState().privateDraft='old-private';expired=true;await c.action('start');
 assert.equal(c.getState().sessionReady,false);assert.equal(c.getState().user.profileReady,false);assert.equal(c.getState().privateDraft,'');assert.equal(c.getState().authRequired,true);
 expired=false;await c.action('start');await c.action('logout');assert.equal(c.getState().screen,'home');assert.equal(c.getState().sessionReady,false);assert.equal(c.getState().user.profileReady,false);
});
test('failed logout leaves the session available for an explicit retry',async()=>{
 const c=createLiveController({render:()=>{},api:{async json(path){if(path==='/api/logout')throw new Error('SESSION_REVOCATION_FAILED');if(path==='/api/auth-me')return session;return ready;}}});
 await c.action('start');await c.action('logout');assert.equal(c.getState().sessionReady,true);assert.match(c.getState().error,/退出未完成/);
});
test('temporary session-store outage preserves private page state for retry',async()=>{
 let outage=false;const c=createLiveController({render:()=>{},api:{async json(path){if(path==='/api/auth-me'){if(outage)throw new Error('SESSION_STORE_UNAVAILABLE');return session;}return ready;}}});
 await c.action('start');c.getState().privateDraft='keep-for-retry';outage=true;await c.action('start');
 assert.equal(c.getState().sessionReady,true);assert.equal(c.getState().user.profileReady,true);assert.equal(c.getState().privateDraft,'keep-for-retry');assert.equal(c.getState().authRequired,false);
});
test('unlinked history is disclosed while the new account still completes background synchronization',async()=>{
 const c=createLiveController({render:()=>{},api:{async json(path){if(path==='/api/auth-me')return{...session,accountNotice:'history_unlinked'};return ready;}}});
 await c.action('start');assert.equal(c.getState().sessionReady,true);assert.equal(c.getState().user.profileReady,true);
 assert.match(entryView(c.getState()),/已登录。旧账号的历史暂未关联，原记录仍保留/);
});

test('initial sync and retry show the specific profile progress message while the API is pending',async()=>{
 let complete;const pending=()=>new Promise(resolve=>{complete=resolve;});
 const c=createLiveController({render:()=>{},api:{async json(path){if(path==='/api/auth-me')return session;return pending();}}});
 const first=c.action('start');await Promise.resolve();await Promise.resolve();
 assert.equal(c.getState().phase,'profile_summary');assert.match(entryView(c.getState()),/正在读取你的知乎足迹，生成你专属的背景介绍/);
 assert.doesNotMatch(entryView(c.getState()),/正在处理/);
 complete({status:'unavailable',reasonCode:'LLM_TIMEOUT_OR_ABORTED',coverage:{creations:2,collections:1},requestId:'test-request-01',diagnostics:{usableCount:3,modelCalled:true,stage:'model'}});await first;
 assert.equal(c.getState().phase,null);assert.match(c.getState().profileNotice,/生成背景超时/);assert.doesNotMatch(entryView(c.getState()),/正在读取你的知乎足迹/);
 const retry=c.action('retry-profile');assert.equal(c.getState().phase,'profile_summary');assert.match(entryView(c.getState()),/正在读取你的知乎足迹，生成你专属的背景介绍/);
 complete(ready);await retry;assert.equal(c.getState().profileDiagnostic,null);assert.equal(c.getState().user.profileReady,true);
 assert.doesNotMatch(entryView(c.getState()),/复制同步诊断|正在读取你的知乎足迹/);
});
test('failed summary exposes copyable, safe diagnostics without retaining private source data',async()=>{
 const h=harness([Response.json({success:false,data:{status:'unavailable',reasonCode:'LLM_SCHEMA_INVALID',requestId:'safe-request-02',coverage:{creations:3,collections:2},diagnostics:{usableCount:5,modelCalled:true,stage:'model',raw:'private-do-not-copy'},access_token:'secret-do-not-copy',footprints:['private-do-not-copy']}},{status:503})]);
 await h.c.action('start');
 assert.match(h.c.getState().profileNotice,/没有生成完整可用的背景介绍/);assert.match(h.html,/data-action="copy-profile-diagnostic"/);assert.match(h.html,/safe-request-02/);
 assert.deepEqual(h.c.getState().profileDiagnostic,{reasonCode:'LLM_SCHEMA_INVALID',requestId:'safe-request-02',coverage:{creations:3,collections:2},diagnostics:{usableCount:5,modelCalled:true,stage:'model'}});
 assert.doesNotMatch(h.html,/private-do-not-copy|secret-do-not-copy/);
});
test('model rate limits and model configuration failures stay separate from Zhihu authorization',async()=>{
 for(const [code,expected] of [['LLM_HTTP_429',/背景生成服务暂时受限/],['LLM_HTTP_401',/背景生成服务的配置暂不可用/],['LLM_NETWORK_ERROR',/背景生成服务暂时没有连通/],['LLM_HTTP_503',/背景生成服务暂时没有连通/]]){
  const h=harness([Response.json({success:false,data:{reasonCode:code,coverage:{creations:2,collections:1}}},{status:503})]);await h.c.action('start');assert.match(h.c.getState().profileNotice,expected);assert.equal(h.c.getState().profileNeedsLogin,false);
 }
});
