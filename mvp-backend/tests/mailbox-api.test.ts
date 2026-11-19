import request from "supertest";
import {afterEach,describe,expect,it,vi} from "vitest";
import {createApp} from "../src/api/app.js";
import {loadConfig} from "../src/config.js";
import {identityHeaders} from "../src/security/identity.js";
import {InMemoryWorkflowStore} from "../src/workflow/store.js";
import {WorkflowService} from "../src/workflow/service.js";
import {ChatService} from "../src/chat/service.js";
import {WorkflowMockProvider} from "../src/llm/workflow-mock-provider.js";
import {BusinessStoreError} from "../src/chat/store.js";
import type {DiscoveryResult} from "../src/contracts/schemas.js";

const token="mailbox-test-token-with-at-least-32-characters",signing="mailbox-signing-secret-with-at-least-32-characters";
const author="11111111-1111-4111-8111-111111111111",reader="22222222-2222-4222-8222-222222222222",stranger="33333333-3333-4333-8333-333333333333";
const config=loadConfig({NODE_ENV:"test",APP_API_TOKEN:token,IDENTITY_SIGNING_SECRET:signing,IP_HASH_SECRET:"mailbox-ip-hash-key-with-at-least-32-characters",RATE_USER_MAX:"500",RATE_IP_MAX:"500",DAILY_USER_WORKFLOWS:"500",DAILY_IP_WORKFLOWS:"500"});
afterEach(()=>vi.useRealTimers());
async function setup(appConfig=config) {
  const store=new InMemoryWorkflowStore(),create=()=>new WorkflowMockProvider();
  const convA=await store.createConversation(author),convB=await store.createConversation(reader);
  await store.appendMessage({conversationId:convB.id,ownerId:reader,role:"user",generationStatus:"complete",content:"我仍然想继续做这件事，但一直没等到反馈，不知道怎样判断下一步。"});
  const fields={subject:"还在等待回声",quote:"我仍然在做这件事，只是一直没有等到回应。",context:"持续投入",background:"这个人仍然投入着一件重要的事，也在等待更具体的回应。"};
  async function paper(ownerId:string,conversationId:string,confirm=true,contactAllowed=true) {
    const p=await store.createPaperDraft({ownerId,conversationId,...fields});
    return confirm?store.confirmPaper({id:p.id,ownerId,expectedVersion:1,discoverableUntil:new Date(Date.now()+7*86400000).toISOString(),identityDisclosure:"anonymous",contactAllowed}):p;
  }
  const original=await paper(author,convA.id);
  const result={requestId:crypto.randomUUID(),status:"matched",matches:{situationClose:{candidateId:original.expressionId,path:"situationClose",sourceType:"authorized_private",sourceUrl:null,authorProfileUrl:null,contactable:true,publishedAt:new Date().toISOString(),evidenceRefs:[{side:"candidate",quote:fields.quote}],sharedRelation:"都在等待具体的回声"},structureRelated:null}} as unknown as DiscoveryResult;
  const discovery=await store.saveDiscovery(reader,convB.id,result);
  const app=createApp({config:appConfig,runtime:{evaluateDetailed:async()=>{throw new Error("No model or matching expected");}},workflowStore:store,chatService:new ChatService(store,create),workflowService:new WorkflowService(store,create)});
  function call(method:"get"|"post"|"patch",path:string,ownerId=reader,body?:object) {
    let req=request(app)[method](path).set(identityHeaders(signing,token,{method:method.toUpperCase(),path,userId:ownerId,sessionId:"session-"+ownerId,role:"user"})).set("Idempotency-Key",crypto.randomUUID());
    if(body!==undefined)req=req.send(body);return req;
  }
  const open=()=>call("post","/api/discussions",reader,{discoveryId:discovery.id,candidateId:original.expressionId});
  return {store,app,convA,convB,original,discovery,result,paper,call,open};
}
describe("persisted mailbox API and access rules",()=>{
  it("rejects unauthenticated access and reader-forged matching records",async()=>{
    const h=await setup();await request(h.app).get("/api/mailbox").expect(401);
    const path=`/api/discoveries/${h.discovery.id}/candidates/${h.original.expressionId}`;
    const own=await h.call("get",path);expect(own.status).toBe(200);expect(own.body.data.paper.displayName).toBe("匿名用户");
    expect((await h.call("get",path,stranger)).status).toBe(403);
    expect((await h.call("get",`/api/papers/${h.original.id}`)).status).toBe(403);
  });
  it("requires a confirmed, contactable own paper; a draft does not unlock replies",async()=>{
    const h=await setup();let response=await h.open();expect(response.status).toBe(409);expect(response.body.error.code).toBe("OWN_PAPER_REQUIRED");
    await h.paper(reader,h.convB.id,false);expect((await h.open()).body.error.code).toBe("OWN_PAPER_REQUIRED");
    await h.paper(reader,h.convB.id,true,false);expect((await h.open()).body.error.code).toBe("OWN_PAPER_REQUIRED");
    await h.paper(reader,h.convB.id);response=await h.open();expect(response.status).toBe(200);expect(response.body.data.canReply).toBe(true);
  });
  it("allows independent deposit with explicit scope, then restores owner-scoped history",async()=>{
    const h=await setup();
    const draft=await h.call("post","/api/papers/drafts",reader,{conversationId:h.convB.id,confirmedProfile:null});expect(draft.status).toBe(201);
    const p=draft.body.data;
    const confirmed=await h.call("post",`/api/papers/${p.id}/confirm`,reader,{expectedVersion:p.version,discoverableDays:7,matchingAllowed:false,identityDisclosure:"anonymous",contactAllowed:true,target:{kind:"mailbox_only"}});
    expect(confirmed.status).toBe(200);expect(confirmed.body.data.paper).toMatchObject({matchingAllowed:false,identityDisclosure:"anonymous",contactAllowed:true});
    const history=await h.call("get","/api/mailbox");expect(history.body.data.papers).toHaveLength(1);expect(history.body.data.papers[0].id).toBe(p.id);
    const outsider=await h.call("get","/api/mailbox",stranger);expect(outsider.body.data.papers).toEqual([]);expect(outsider.body.data.conversations).toEqual([]);
    const restored=await h.call("get",`/api/conversations/${h.convB.id}`);expect(restored.body.data.messages[0].content).toContain("一直没等到反馈");
    await h.call("get",`/api/conversations/${h.convB.id}`,stranger).expect(403);
  });
  it("a selected real-paper confirmation appears in both histories before either participant opens it",async()=>{
    const h=await setup(),draft=await h.paper(reader,h.convB.id,false);
    const body={expectedVersion:draft.version,discoverableDays:7,matchingAllowed:false,identityDisclosure:"anonymous",contactAllowed:true,target:{kind:"selected_private",discoveryId:h.discovery.id,candidateId:h.original.expressionId}};
    const confirmed=await h.call("post",`/api/papers/${draft.id}/confirm`,reader,body);
    expect(confirmed.status).toBe(200);
    const inbox=await h.call("get","/api/mailbox",author),sent=await h.call("get","/api/mailbox",reader);
    expect(inbox.body.data.discussions).toHaveLength(1);
    expect(sent.body.data.discussions).toHaveLength(1);
    expect(inbox.body.data.discussions[0].introduction.id).toBe(draft.id);
    expect(sent.body.data.discussions[0].id).toBe(inbox.body.data.discussions[0].id);
    const retried=await h.call("post",`/api/papers/${draft.id}/confirm`,reader,body);
    expect(retried.status).toBe(200);expect(retried.body.data.delivery.id).toBe(confirmed.body.data.delivery.id);
    expect((await h.call("get","/api/mailbox",author)).body.data.discussions).toHaveLength(1);
    expect((await h.call("get","/api/mailbox",stranger)).body.data.discussions).toEqual([]);
  });
  it("can recover discussion creation after confirmation was already committed",async()=>{
    const h=await setup(),draft=await h.paper(reader,h.convB.id,false);
    const open=vi.spyOn(h.store,"openDiscussion");open.mockRejectedValueOnce(new BusinessStoreError("UNAVAILABLE"));
    const body={expectedVersion:1,contactAllowed:true,target:{kind:"selected_private",discoveryId:h.discovery.id,candidateId:h.original.expressionId}};
    await h.call("post",`/api/papers/${draft.id}/confirm`,reader,body).expect(503);
    expect((await h.store.getPaper(draft.id,reader)).status).toBe("active");
    await h.call("post",`/api/papers/${draft.id}/confirm`,reader,body).expect(200);
    expect((await h.call("get","/api/mailbox",author)).body.data.discussions).toHaveLength(1);
  });
  it("persists both participants' replies; retries and concurrent duplicates produce one reply",async()=>{
    const h=await setup();await h.paper(reader,h.convB.id);const opened=await h.open(),id=opened.body.data.id;
    expect((await h.open()).body.data.id).toBe(id);
    const body={content:"谢谢你，我也有类似的近况。",clientMessageId:crypto.randomUUID()};
    const replies=await Promise.all([h.call("post",`/api/discussions/${id}/replies`,reader,body),h.call("post",`/api/discussions/${id}/replies`,reader,body)]);
    expect(replies.every(r=>r.status===200)).toBe(true);
    let loaded=await h.call("get",`/api/discussions/${id}`,author);expect(loaded.body.data.messages).toHaveLength(1);expect(loaded.body.data.messages[0].own).toBe(false);
    const reply=await h.call("post",`/api/discussions/${id}/replies`,author,{content:"愿意多聊聊么？",clientMessageId:crypto.randomUUID()});expect(reply.status).toBe(200);
    loaded=await h.call("get",`/api/discussions/${id}`);expect(loaded.body.data.messages).toHaveLength(2);expect(loaded.body.data.messages[1].own).toBe(false);
    expect((await h.call("post",`/api/discussions/${id}/replies`,reader,{...body,content:"同一个编号不能换内容"})).status).toBe(409);
    await h.call("get",`/api/discussions/${id}`,stranger).expect(404);
    await h.call("post",`/api/discussions/${id}/replies`,stranger,{content:"不应写入",clientMessageId:crypto.randomUUID()}).expect(404);
    expect((await h.call("get","/api/mailbox",author)).body.data.discussions[0].id).toBe(id);
  });
  it("keeps established discussions after 7 days, and redacts withdrawn papers while keeping replies",async()=>{
    vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(new Date("2026-11-19T02:00:00Z"));
    const h=await setup(),intro=await h.paper(reader,h.convB.id);const id=(await h.open()).body.data.id;
    await h.call("post",`/api/discussions/${id}/replies`,reader,{content:"到期前留下一句话",clientMessageId:crypto.randomUUID()}).expect(200);
    vi.setSystemTime(new Date("2026-11-27T02:00:00Z"));
    const continued=await h.call("post",`/api/discussions/${id}/replies`,author,{content:"到期后已有交流可以继续",clientMessageId:crypto.randomUUID()});expect(continued.status).toBe(200);expect(continued.body.data.paper.status).toBe("expired");
    await h.call("post",`/api/papers/${intro.id}/withdraw`,reader,{}).expect(200);
    const closed=await h.call("get",`/api/discussions/${id}`,author);expect(closed.body.data).toMatchObject({canReply:false,closedReason:"paper_withdrawn",introduction:{status:"withdrawn",quote:null,background:null}});expect(closed.body.data.messages).toHaveLength(2);
    const blocked=await h.call("post",`/api/discussions/${id}/replies`,author,{content:"不应新增",clientMessageId:crypto.randomUUID()});expect(blocked.status).toBe(409);expect(blocked.body.error.code).toBe("DISCUSSION_CLOSED");
    expect((await h.call("get",`/api/papers/${intro.id}`,reader)).body.data.quote).not.toBeNull();
  });
  it("rejects invalid reply bodies, client-selected owners and discovery windows beyond 7 days",async()=>{
    const h=await setup();await h.paper(reader,h.convB.id);const id=(await h.open()).body.data.id;
    for(const body of [{content:"",clientMessageId:crypto.randomUUID()},{content:"x".repeat(2001),clientMessageId:crypto.randomUUID()},{content:"你好",clientMessageId:"no-id"},{content:"你好",clientMessageId:crypto.randomUUID(),senderId:author}])await h.call("post",`/api/discussions/${id}/replies`,reader,body).expect(400);
    const p=await h.paper(reader,h.convB.id,false);await h.call("post",`/api/papers/${p.id}/confirm`,reader,{expectedVersion:1,discoverableDays:30}).expect(400);
  });
  it("meters history separately from model workflows and still limits mailbox actions",async()=>{
    const h=await setup({...config,quota:{...config.quota,dailyUserWorkflows:1,dailyUserMailboxActions:3}});
    for(let n=0;n<3;n++)await h.call("get","/api/mailbox").expect(200);
    const blocked=await h.call("get","/api/mailbox");expect(blocked.status).toBe(429);expect(blocked.body.error.code).toBe("DAILY_QUOTA_EXCEEDED");
    await h.call("post","/api/papers/drafts",reader,{conversationId:h.convB.id,confirmedProfile:null}).expect(201);
  });
  it("does not claim persistent mailbox success for session deployments configured with memory storage",async()=>{
    const h=await setup();
    const sessionConfig={...config,authMode:"session" as const,businessStoreMode:"memory" as const,corsOrigins:["https://app.example"]};
    const create=()=>new WorkflowMockProvider();
    const app=createApp({config:sessionConfig,runtime:{evaluateDetailed:async()=>{throw new Error("No matching expected");}},sessionResolver:async()=>({userId:reader,sessionId:crypto.randomUUID(),role:"user",status:"active"}),workflowStore:h.store,chatService:new ChatService(h.store,create),workflowService:new WorkflowService(h.store,create)});
    const response=await request(app).get("/api/mailbox");expect(response.status).toBe(503);expect(response.body.error.code).toBe("MAILBOX_PERSISTENCE_REQUIRED");
  });

  it("does not return a private snapshot withdrawn while the model is analyzing it",async()=>{
    const h=await setup(),create=()=>new WorkflowMockProvider();
    const chat=await h.call("post","/api/chat/reply",reader,{conversationId:h.convB.id,message:"我仍然想坚持，只是一直没有得到具体的回应。"});
    const done=JSON.parse(chat.text.match(/event: done\ndata: (.+)/)![1]!);
    const app=createApp({config,runtime:{evaluateDetailed:async()=>{
      await h.store.withdrawPaper(h.original.id,author);
      return {result:h.result,trace:{requestId:h.result.requestId,matchPolicy:null,stages:[],rejectedMatches:[]}};
    }},workflowStore:h.store,chatService:new ChatService(h.store,create),workflowService:new WorkflowService(h.store,create)});
    const path=`/api/conversations/${h.convB.id}/discovery`;
    const response=await request(app).post(path).set(identityHeaders(signing,token,{method:"POST",path,userId:reader,sessionId:"session-reader",role:"user"})).set("Idempotency-Key",crypto.randomUUID()).send({assistantMessageId:done.assistantMessageId,topicKey:done.discovery.topicKey});
    expect(response.status).toBe(200);expect(response.body.data.status).toBe("no_match");expect(response.body.data.reasonCode).toBe("candidate_no_longer_available");expect(response.body.data.discoveryId).toBeNull();
    expect(response.text).not.toContain(h.original.quote);expect(await h.store.listTopicDisplays(h.convB.id,reader)).toHaveLength(0);
  });

});
