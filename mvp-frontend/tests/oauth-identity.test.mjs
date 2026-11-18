import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import callback from '../api/zhihu-callback.mjs';
import { encryptToken } from '../server/token-crypto.mjs';
const oldId='11111111-1111-4111-8111-111111111111';
const newId='22222222-2222-4222-8222-222222222222';
const sessionId='33333333-3333-4333-8333-333333333333';
const sessionToken='a'.repeat(43);
const legacy=token=>'oauth_'+createHash('sha256').update(token).digest('hex');
const expiry=()=>new Date(Date.now()+86400000).toISOString();
function response(){const headers=new Map();return{statusCode:200,setHeader(k,v){headers.set(k.toLowerCase(),v);},getHeader(k){return headers.get(k.toLowerCase());},status(c){this.statusCode=c;return this;},send(b){this.body=b;return this;},redirect(c,url){this.statusCode=c;this.location=url;return this;}};}
function harness(t,{userPayload={code:20000,data:{id:'stable-account',name:'同名用户'}},token='new-test-token',expires=3600,currentKey=null,priorPayload,priorExpires=expiry(),existing=[]}={}){
 for(const [k,v] of Object.entries({ZHIHU_APP_ID:'test-app',ZHIHU_APP_KEY:'test-key',ZHIHU_REDIRECT_URI:'https://app.example/api/zhihu-callback',SITE_URL:'https://app.example',SUPABASE_URL:'https://test.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'sb_secret_synthetic',TOKEN_ENCRYPTION_KEY:'synthetic-test-encryption-key-at-least-32'})){
  const old=process.env[k];process.env[k]=v;t.after(()=>{if(old===undefined)delete process.env[k];else process.env[k]=old;});
 }
 const users=existing.map(x=>({...x}));if(currentKey&&!users.some(x=>x.id===oldId))users.push({id:oldId,zhihu_user_id:currentKey});
 const writes=[],requests=[],priorToken='prior-test-token';
 const before=globalThis.fetch;t.after(()=>{globalThis.fetch=before;});
 globalThis.fetch=async(input,options={})=>{
  const url=new URL(input);requests.push({path:url.pathname,method:options.method||'GET'});
  assert.equal(options.redirect,'error');assert.ok(options.signal instanceof AbortSignal);
  if(url.pathname==='/access_token')return Response.json({code:20000,access_token:token,expires_in:expires,token_type:'Bearer'});
  if(url.pathname==='/user')return Response.json(options.headers.Authorization==='Bearer '+priorToken ? (priorPayload??userPayload) : userPayload);
  assert.equal(url.hostname,'test.supabase.co');
  const table=url.pathname.split('/').at(-1),method=options.method||'GET';
  if(method!=='GET'){
   const body=JSON.parse(options.body);writes.push({table,method,body});
   if(table==='users'&&method==='PATCH'){
    const row=users.find(x=>'eq.'+x.id===url.searchParams.get('id'));
    if(!row)return Response.json([]);Object.assign(row,body);return Response.json([row]);
   }
   if(table==='users'){
    let row=users.find(x=>x.zhihu_user_id===body.zhihu_user_id);
    if(!row){row={id:newId,...body};users.push(row);}else Object.assign(row,body);
    return Response.json([row]);
   }
   return new Response(null,{status:201});
  }
  if(table==='app_sessions')return Response.json(currentKey?[{id:sessionId,user_id:oldId,expires_at:expiry(),revoked_at:null}]:[]);
  if(table==='zhihu_accounts')return Response.json([{user_id:oldId,access_token:encryptToken(priorToken),token_type:'Bearer',token_storage_version:'encrypted_v1',expires_at:priorExpires}]);
  if(table==='users')return Response.json(users.filter(x=>
   (!url.searchParams.has('id')||'eq.'+x.id===url.searchParams.get('id'))&&
   (!url.searchParams.has('zhihu_user_id')||'eq.'+x.zhihu_user_id===url.searchParams.get('zhihu_user_id'))));
  throw new Error('Unexpected synthetic test request');
 };
 return {users,writes,requests,async run(){const res=response();await callback({method:'GET',headers:{cookie:'wjr_oauth_state=expected'+(currentKey?'; wjr_session='+sessionToken:'')},query:{state:'expected',code:'synthetic-authorization-code'}},res);return res;}};
}
test('documented OAuth 20000 success keeps one user ID across different tokens',async t=>{
 const existing=[{id:oldId,zhihu_user_id:'stable-account'}];
 const h=harness(t,{existing});const res=await h.run();assert.equal(res.statusCode,302);
 assert.equal(h.users.length,1);assert.equal(h.writes.find(x=>x.table==='zhihu_accounts').body.user_id,oldId);
 assert.equal(h.writes.find(x=>x.table==='app_sessions').body.user_id,oldId);
 assert.equal(h.writes.find(x=>x.table==='zhihu_accounts').body.token_storage_version,'encrypted_v1');
 assert.notEqual(h.writes.find(x=>x.table==='zhihu_accounts').body.access_token,'new-test-token');
});
test('accepts string 20000 and a JSON-encoded user object',async t=>{
 const h=harness(t,{userPayload:{Code:'20000',Data:JSON.stringify({user_id:'stable-account'})}});
 assert.equal((await h.run()).statusCode,302);assert.equal(h.users[0].zhihu_user_id,'stable-account');
});
test('an exact prior token safely upgrades its legacy identity while retaining the user UUID',async t=>{
 const h=harness(t,{existing:[{id:oldId,zhihu_user_id:legacy('new-test-token')}]});
 assert.equal((await h.run()).statusCode,302);assert.equal(h.users.length,1);assert.equal(h.users[0].id,oldId);assert.equal(h.users[0].zhihu_user_id,'stable-account');
});
test('reauthorization verifies the previous OAuth identity before migrating a legacy UUID',async t=>{
 const h=harness(t,{currentKey:legacy('prior-test-token')});
 assert.equal((await h.run()).statusCode,302);assert.equal(h.users.length,1);assert.equal(h.users[0].id,oldId);assert.equal(h.users[0].zhihu_user_id,'stable-account');
 assert.equal(h.requests.filter(x=>x.path==='/user').length,2);
});
test('a different stable Zhihu identity creates a separate user even with the same display name',async t=>{
 const h=harness(t,{currentKey:legacy('prior-test-token'),priorPayload:{code:20000,data:{id:'other-account',name:'同名用户'}}});
 assert.equal((await h.run()).statusCode,302);assert.equal(h.users.length,2);assert.equal(h.users[0].zhihu_user_id,legacy('prior-test-token'));
 assert.equal(h.writes.find(x=>x.table==='app_sessions').body.user_id,newId);
});
test('unverifiable legacy history does not reject a valid new login or merge old data',async t=>{
 const h=harness(t,{currentKey:legacy('prior-test-token'),priorPayload:{code:20004,data:{id:'stable-account'}}});
 const res=await h.run();assert.equal(res.statusCode,302);
 assert.equal(h.users.length,2);assert.equal(h.users.find(x=>x.id===oldId).zhihu_user_id,legacy('prior-test-token'));
 assert.equal(h.writes.filter(x=>x.table==='users'&&x.method==='PATCH').length,0);
 assert.equal(h.writes.find(x=>x.table==='zhihu_accounts').body.user_id,newId);
 assert.equal(h.writes.find(x=>x.table==='app_sessions').body.user_id,newId);
 assert.match(res.getHeader('set-cookie').join(';'),/wjr_account_notice=history_unlinked/);
});
test('conflicting existing UUIDs stay separate while the newly authorized account can log in',async t=>{
 const h=harness(t,{currentKey:legacy('prior-test-token'),existing:[{id:newId,zhihu_user_id:'stable-account'}]});
 const res=await h.run();assert.equal(res.statusCode,302);assert.equal(h.users.length,2);
 assert.equal(h.users.find(x=>x.id===oldId).zhihu_user_id,legacy('prior-test-token'));
 assert.equal(h.writes.filter(x=>x.table==='users'&&x.method==='PATCH').length,0);
 assert.equal(h.writes.find(x=>x.table==='app_sessions').body.user_id,newId);
 assert.match(res.getHeader('set-cookie').join(';'),/wjr_account_notice=history_unlinked/);
});
test('a newly authorized token without a stable ID can log in separately from the prior account',async t=>{
 const h=harness(t,{currentKey:legacy('prior-test-token'),userPayload:{code:20004}});
 const res=await h.run();assert.equal(res.statusCode,302);assert.equal(h.users.length,2);
 assert.equal(h.users.find(x=>x.id===oldId).zhihu_user_id,legacy('prior-test-token'));
 assert.equal(h.users.find(x=>x.id===newId).zhihu_user_id,legacy('new-test-token'));
 assert.equal(h.writes.filter(x=>x.table==='users'&&x.method==='PATCH').length,0);
 assert.match(res.getHeader('set-cookie').join(';'),/wjr_account_notice=history_unlinked/);
});
test('expired old authorization does not block a valid new grant or overwrite the old account',async t=>{
 const h=harness(t,{currentKey:legacy('prior-test-token'),priorExpires:'2000-01-01T00:00:00Z'});
 const res=await h.run();assert.equal(res.statusCode,302);assert.equal(h.users.length,2);
 assert.equal(h.writes.filter(x=>x.table==='users'&&x.method==='PATCH').length,0);
 assert.equal(h.requests.filter(x=>x.path==='/user').length,1);
 assert.match(res.getHeader('set-cookie').join(';'),/wjr_account_notice=history_unlinked/);
});
test('error codes and arbitrary string data are never accepted as stable user IDs',async t=>{
 for(const userPayload of [{code:20004,data:{id:'do-not-trust'}},{code:20000,data:'do-not-trust'},{code:20000,data:[{id:'do-not-trust'}]}]){
  const h=harness(t,{userPayload});assert.equal((await h.run()).statusCode,302);assert.equal(h.users[0].zhihu_user_id,legacy('new-test-token'));
 }
});
test('missing or invalid expiry cannot create a user or session',async t=>{
 for(const expires of [0,-1,'invalid',null]){
  const h=harness(t,{expires});const res=await h.run();assert.equal(res.statusCode,502);assert.equal(res.getHeader('x-oauth-error'),'TOKEN_EXPIRY_INVALID');assert.equal(h.writes.length,0);
 }
});
test('OAuth network errors return a safe actionable failure',async t=>{
 const h=harness(t);globalThis.fetch=async()=>{throw new Error('private-token-do-not-expose');};
 const res=await h.run();assert.equal(res.statusCode,502);assert.doesNotMatch(res.body,/private-token|synthetic-authorization/);assert.equal(h.writes.length,0);
});
