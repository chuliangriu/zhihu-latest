import test from 'node:test';
import assert from 'node:assert/strict';
import login from '../api/zhihu-login.mjs';
import callback from '../api/zhihu-callback.mjs';
function response() {
  const headers = new Map();
  return {statusCode:200,body:null,setHeader(k,v){headers.set(k.toLowerCase(),v);},getHeader(k){return headers.get(k.toLowerCase());},
    status(c){this.statusCode=c;return this;},send(b){this.body=b;return this;},redirect(c,b){this.statusCode=c;this.location=b;return this;}};
}
function configure(t) {
  for(const [name,value] of Object.entries({ZHIHU_APP_ID:'test-app',ZHIHU_APP_KEY:'test-key',ZHIHU_REDIRECT_URI:'https://app.example/api/zhihu-callback'})){
    const old=process.env[name];process.env[name]=value;t.after(()=>{if(old===undefined)delete process.env[name];else process.env[name]=old;});
  }
}
test('login creates a fresh, uncached state redirect bound to a secure browser cookie',t=>{
  configure(t);const values=[];
  for(let i=0;i<2;i++){
    const res=response();login({method:'GET'},res);assert.equal(res.statusCode,302);
    const u=new URL(res.location);const state=u.searchParams.get('state');assert.match(state,/^[A-Za-z0-9_-]{43}$/);
    assert.equal(u.origin,'https://openapi.zhihu.com');assert.equal(u.searchParams.get('redirect_uri'),process.env.ZHIHU_REDIRECT_URI);
    const cookie=res.getHeader('set-cookie')[0];assert.ok(cookie.startsWith('wjr_oauth_state='+state+';'));
    for(const flag of ['Path=/','HttpOnly','Secure','SameSite=Lax','Max-Age=600'])assert.ok(cookie.includes(flag));
    assert.equal(res.getHeader('cache-control'),'no-store');assert.equal(res.getHeader('referrer-policy'),'no-referrer');values.push(state);
  }assert.notEqual(values[0],values[1]);
});
test('callback distinguishes missing, malformed, mismatched and ambiguous state without contacting providers',async t=>{
  const fetchBefore=globalThis.fetch;globalThis.fetch=()=>{throw new Error('must not make a network call');};t.after(()=>{globalThis.fetch=fetchBefore;});
  for(const [cookie,state,reason] of [
    ['', 'returned', 'STATE_COOKIE_MISSING'],
    ['wjr_oauth_state=%E0%A4%A', 'returned', 'STATE_COOKIE_MISSING'],
    ['wjr_oauth_state=expected', undefined, 'STATE_PARAMETER_MISSING'],
    ['wjr_oauth_state=expected', 'different', 'STATE_MISMATCH'],
    ['wjr_oauth_state=expected', ['expected','different'], 'STATE_MISMATCH'],
  ]){
    const res=response();await callback({method:'GET',headers:{cookie},query:{state,authorization_code:'synthetic-code'}},res);
    assert.equal(res.statusCode,400);assert.equal(res.getHeader('x-oauth-error'),reason);assert.equal(res.getHeader('cache-control'),'no-store');
    assert.ok(!res.body.includes('synthetic-code'));assert.ok(!res.body.includes('expected'));
  }
});
test('matching state permits token exchange and clears the temporary cookie',async t=>{
  configure(t);const oldFetch=globalThis.fetch;let calls=0;
  globalThis.fetch=async(url,opts)=>{calls++;assert.equal(url,'https://openapi.zhihu.com/access_token');assert.equal(opts.body.get('code'),'synthetic-code');return {ok:false,json:async()=>({})};};
  t.after(()=>{globalThis.fetch=oldFetch;});const res=response();
  await callback({method:'GET',headers:{cookie:'wjr_oauth_state=expected'},query:{state:'expected',authorization_code:'synthetic-code'}},res);
  assert.equal(calls,1);assert.equal(res.statusCode,502);assert.ok(res.getHeader('set-cookie')[0].includes('Max-Age=0'));
  assert.equal(res.getHeader('x-oauth-error'),undefined);
});
