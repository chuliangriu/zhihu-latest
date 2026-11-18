import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createApi,discoveryView} from '../public/mvp-api.js';
import {createLiveController} from '../public/mvp-live.js';
import {createApp} from '../../mvp-backend/dist/api/app.js';
import {loadConfig} from '../../mvp-backend/dist/config.js';
import {identityHeaders} from '../../mvp-backend/dist/security/identity.js';
import {InMemoryWorkflowStore} from '../../mvp-backend/dist/workflow/store.js';
import {WorkflowService} from '../../mvp-backend/dist/workflow/service.js';
import {ChatService} from '../../mvp-backend/dist/chat/service.js';
import {WorkflowMockProvider} from '../../mvp-backend/dist/llm/workflow-mock-provider.js';

const require=createRequire(new URL('../../mvp-backend/package.json',import.meta.url));
const request=require('supertest');

// Isolated test identities and model fixture; never sends messages to a real person.
test('private frontend actions use real backend draft, confirm/deliver, handoff and withdrawal routes',async()=>{
  const token='test-api-token-longer-than-thirty-two-characters';
  const signing='test-signing-key-longer-than-thirty-two-characters';
  const config=loadConfig({NODE_ENV:'test',APP_API_TOKEN:token,IDENTITY_SIGNING_SECRET:signing,
    IP_HASH_SECRET:'test-ip-hash-key-longer-than-thirty-two-characters',RATE_USER_MAX:'30',RATE_IP_MAX:'30'});
  const store=new InMemoryWorkflowStore(),owner='test-sender',other='test-other';
  const recipient='33333333-3333-4333-8333-333333333333';
  const conversation=await store.createConversation(owner);
  await store.appendMessage({ownerId:owner,conversationId:conversation.id,role:'user',generationStatus:'complete',content:'我还在做这件事，只是没有回声，不知道怎样判断下一步。'});
  const result={requestId:crypto.randomUUID(),status:'matched',matches:{situationClose:null,structureRelated:{
    candidateId:recipient,path:'structureRelated',sourceType:'authorized_private',sourceUrl:null,
    authorProfileUrl:'https://www.zhihu.com/people/test-recipient',contactable:true,authorDisplayName:'测试接收方',
    profileBackground:['这个人下班后持续写小说。','他会反复修改章节，也在等待读者回应。'],
    recentFocus:'小说仍想继续写，却越来越难判断下一步。',
    publishedAt:new Date().toISOString(),sharedRelation:'都在寻找判断下一步的依据',
    evidenceRefs:[{side:'candidate',refId:recipient,quote:'我也在等待回应。'}]}}};
  const snapshot=await store.saveDiscovery(owner,conversation.id,result);
  const app=createApp({config,runtime:{evaluateDetailed:async()=>{throw Error('No matching invocation expected');}},
    workflowStore:store,chatService:new ChatService(store,()=>new WorkflowMockProvider()),workflowService:new WorkflowService(store,()=>new WorkflowMockProvider())});
  let principal=owner;const calls=[],navigation=[];
  const api=createApi(async(path,options)=>{
    if(path==='/api/auth-me')return Response.json({success:true,localDevelopment:true,user:{id:owner,display_name:'测试发送方'}});
    const body=options.body?JSON.parse(options.body):undefined;
    calls.push({path,body});
    let req=request(app)[options.method.toLowerCase()](path)
      .set(identityHeaders(signing,token,{method:options.method,path,userId:principal,sessionId:'test-session-'+principal,role:'user'}))
      .set('Idempotency-Key',options.headers['Idempotency-Key']);
    if(body)req=req.send(body);
    const res=await req;
    return new Response(res.text,{status:res.status,headers:{'Content-Type':'application/json'}});
  });
  const timers=new Map();let sequence=0;
  const c=createLiveController({api,render:()=>{},navigate:url=>navigation.push(url),
    schedule:fn=>{timers.set(++sequence,fn);return sequence;},cancel:id=>timers.delete(id)});
  const finish=()=>{for(let n=0;timers.size&&n<1000;n++){const [id,fn]=timers.entries().next().value;timers.delete(id);fn();}assert.equal(timers.size,0);};
  c.initialize();await c.action('start');await c.action('enter-chat');
  const s=c.getState();s.conversationId=conversation.id;s.discoveryId=snapshot.id;
  s.user.candidates=discoveryView(result,'测试发送方').candidates;
  assert.deepEqual(s.user.candidates.A.profile,result.matches.structureRelated.profileBackground);
  assert.equal(s.user.candidates.A.focus,result.matches.structureRelated.recentFocus);
  await c.action('view','A');await c.action('write');await c.action('confirm-consent');
  assert.equal(s.error,'');assert.equal(s.paper.status,'draft');
  await c.action('deposit');assert.equal(s.error,'');finish();
  assert.equal(s.paper.status,'active');assert.equal(s.delivery.status,'delivered');
  assert.equal(s.delivery.candidateId,recipient);
  assert.equal((await store.getPaper(s.paper.id,owner)).status,'active');
  // Replaying the same confirmation must not create another delivery.
  const confirmation=calls.find(x=>x.path.endsWith('/confirm'));
  const repeated=await api.json(confirmation.path,confirmation.body);
  assert.equal(repeated.delivery.id,s.delivery.id);
  await c.action('continue-private');c.input('privateDraft','这段私人文字不应被传到跳转接口');await c.action('send-private');
  assert.equal(s.error,'');assert.deepEqual(navigation,['https://www.zhihu.com/people/test-recipient']);
  assert.deepEqual(calls.find(x=>x.path==='/api/handoffs').body,{discoveryId:snapshot.id,candidateId:recipient});
  principal=other;
  await assert.rejects(api.json('/api/handoffs',{discoveryId:snapshot.id,candidateId:recipient}));
  principal=owner;await c.action('withdraw-paper');assert.equal(s.error,'');
  assert.equal((await store.getPaper(s.paper.id,owner)).status,'withdrawn');
});
