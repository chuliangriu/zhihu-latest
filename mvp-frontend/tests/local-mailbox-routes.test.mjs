import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createLocalBackend } from '../local-backend.mjs';

test('loopback service forwards authenticated mailbox, history and discussion routes without calling external services',async()=>{
  const before={...process.env};
  Object.assign(process.env,{NODE_ENV:'test',LLM_API_KEY:'synthetic-local-route-test-key',LLM_MODEL:'synthetic-model'});
  for(const key of ['ZHIHU_ACCESS_SECRET','SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','BUSINESS_STORE_MODE'])delete process.env[key];
  let handler;
  const server=http.createServer((req,res)=>handler(req,res));
  try {
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const origin=`http://127.0.0.1:${server.address().port}`;
    handler=createLocalBackend(origin);
    assert.equal((await fetch(origin+'/api/mailbox')).status,401);
    const auth=await fetch(origin+'/api/auth-me');assert.equal(auth.status,200);
    const cookie=auth.headers.get('set-cookie').split(';')[0];
    const send=(path,method='GET',body)=>fetch(origin+path,{method,headers:{Origin:origin,Cookie:cookie,'Content-Type':'application/json','Idempotency-Key':crypto.randomUUID()},...(body?{body:JSON.stringify(body)}:{})});
    const mailbox=await send('/api/mailbox');assert.equal(mailbox.status,200);assert.deepEqual((await mailbox.json()).data,{papers:[],discussions:[],conversations:[]});
    const random=crypto.randomUUID();
    for(const path of [`/api/conversations/${random}`,`/api/discussions/${random}`,`/api/discoveries/${random}/candidates/${crypto.randomUUID()}`]) {
      const r=await send(path);assert.equal(r.status,404);assert.equal((await r.json()).error.code,'STORE_NOT_FOUND');
    }
    const open=await send('/api/discussions','POST',{discoveryId:random,candidateId:crypto.randomUUID()});
    assert.equal(open.status,404);assert.equal((await open.json()).error.code,'STORE_NOT_FOUND');
    const reply=await send(`/api/discussions/${random}/replies`,'POST',{content:'隔离路由测试',clientMessageId:crypto.randomUUID()});
    assert.equal(reply.status,404);assert.equal((await reply.json()).error.code,'STORE_NOT_FOUND');
  } finally {
    server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
    for(const key of Object.keys(process.env))if(!(key in before))delete process.env[key];
    Object.assign(process.env,before);
  }
});
