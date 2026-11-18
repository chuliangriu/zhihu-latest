import test from 'node:test';
import assert from 'node:assert/strict';
import { requireUser, readCookie } from '../server/auth.mjs';
import me from '../api/auth-me.mjs';
import logout from '../api/logout.mjs';
const token='a'.repeat(43),uid='11111111-1111-4111-8111-111111111111',sid='22222222-2222-4222-8222-222222222222';
const valid=()=>({id:sid,user_id:uid,expires_at:new Date(Date.now()+86400000).toISOString(),revoked_at:null});
function response(){const h=new Map();return{statusCode:200,setHeader(k,v){h.set(k.toLowerCase(),v);},getHeader(k){return h.get(k.toLowerCase());},status(c){this.statusCode=c;return this;},json(b){this.body=b;return this;}};}
function harness(t,session=valid(),user={id:uid,zhihu_user_id:'stable-test-user'},status=200){
 for(const[k,v]of Object.entries({SUPABASE_URL:'https://test.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'sb_secret_test',SITE_URL:'https://app.example'})){const old=process.env[k];process.env[k]=v;t.after(()=>{if(old===undefined)delete process.env[k];else process.env[k]=old;});}
 let calls=0;const oldFetch=globalThis.fetch;t.after(()=>globalThis.fetch=oldFetch);
 globalThis.fetch=async(url,opts)=>{calls++;assert.equal(opts.redirect,'error');assert.ok(opts.signal instanceof AbortSignal);if(opts.method==='PATCH')return new Response(null,{status});return Response.json(String(url).includes('/app_sessions?')?(session?[session]:[]):[user]);};
 return{get calls(){return calls;}};
}
const req=(method='GET')=>({method,headers:{cookie:'wjr_session='+token,origin:'https://app.example','sec-fetch-site':'same-origin'}});
test('duplicate, short and malformed cookies are rejected before database access',async t=>{
 const h=harness(t);for(const cookie of ['wjr_session=x','wjr_session=%E0%A4%A','wjr_session='+token+'; wjr_session='+token])assert.equal(await requireUser({headers:{cookie}}),null);
 assert.equal(h.calls,0);assert.equal(readCookie({headers:{cookie:'wjr_oauth_state=a; wjr_oauth_state=b'}},'wjr_oauth_state'),'');
});
test('expired, revoked and missing sessions cannot authenticate',async t=>{
 for(const session of [null,{...valid(),expires_at:'2000-01-01T00:00:00Z'},{...valid(),revoked_at:new Date().toISOString()}]){
  const h=harness(t,session);assert.equal(await requireUser(req()),null);assert.equal(h.calls,1);
 }
});
test('a mismatched returned user is rejected and identity lookup keys stay server-side',async t=>{
 harness(t,valid(),{id:sid});assert.equal(await requireUser(req()),null);
 harness(t);const res=response();await me(req(),res);assert.equal(res.statusCode,200);assert.equal(res.body.user.id,uid);assert.equal(res.body.user.zhihu_user_id,undefined);assert.equal(res.getHeader('cache-control'),'no-store');
});
test('logout revokes the current session and expires the cookie',async t=>{
 const h=harness(t);const res=response();await logout(req('POST'),res);assert.equal(res.statusCode,200);assert.equal(h.calls,1);assert.match(res.getHeader('set-cookie')[0],/wjr_session=;.*Max-Age=0/);assert.equal(res.getHeader('cache-control'),'no-store');
});
test('logout rejects cross-origin requests without revoking a session',async t=>{
 const h=harness(t);const request=req('POST');request.headers.origin='https://other.example';const res=response();await logout(request,res);assert.equal(res.statusCode,403);assert.equal(h.calls,0);
});
test('failed server revocation must not report successful logout',async t=>{
 harness(t,valid(),{},503);const res=response();await logout(req('POST'),res);assert.equal(res.statusCode,503);assert.equal(res.body.success,false);assert.equal(res.getHeader('set-cookie'),undefined);
});
test('logged-out auth responses cannot be cached',async t=>{
 harness(t,null);const res=response();await me(req(),res);assert.equal(res.statusCode,401);assert.equal(res.getHeader('cache-control'),'no-store');
});
test('database outage is unavailable rather than a logged-out identity',async t=>{
 harness(t);globalThis.fetch=async()=>new Response(null,{status:503});const res=response();await me(req(),res);
 assert.equal(res.statusCode,503);assert.equal(res.body.error,'SESSION_STORE_UNAVAILABLE');assert.equal(res.getHeader('cache-control'),'no-store');
});
