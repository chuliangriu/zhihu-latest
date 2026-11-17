import request from "supertest";
import {describe,expect,it} from "vitest";
import {createApp} from "../src/api/app.js";
import {loadConfig} from "../src/config.js";
import {identityHeaders} from "../src/security/identity.js";
import {DiscoveryRuntime} from "../src/runtime.js";
import {InMemoryWorkflowStore} from "../src/workflow/store.js";
import {WorkflowService} from "../src/workflow/service.js";
import {ChatService} from "../src/chat/service.js";
import {WorkflowMockProvider} from "../src/llm/workflow-mock-provider.js";
import type {DiscoveryResult} from "../src/contracts/schemas.js";
import {LlmProviderError} from "../src/llm/provider.js";

const token="test-token-with-at-least-32-characters";
const signing="identity-signing-secret-with-32-characters";
const secret="ip-hash-secret-with-at-least-32-characters";
const config=loadConfig({NODE_ENV:"test",APP_API_TOKEN:token,IDENTITY_SIGNING_SECRET:signing,IP_HASH_SECRET:secret,RATE_USER_MAX:"20",RATE_IP_MAX:"20",DAILY_USER_WORKFLOWS:"20"});
function auth(method:string,path:string,user="user-1"){return identityHeaders(signing,token,{method,path,userId:user,sessionId:`session-${user}`,role:"user"});}

describe("formal workflow API",()=>{
  it.each([
    ["LLM_SCHEMA_INVALID",502,"LLM_OUTPUT_INVALID"],
    ["LLM_OUTPUT_NOT_JSON",502,"LLM_OUTPUT_INVALID"],
    ["LLM_TIMEOUT_OR_ABORTED",504,"LLM_TIMEOUT"],
    ["LLM_HTTP_429",503,"LLM_UPSTREAM_BUSY"],
    ["LLM_HTTP_401",503,"LLM_UNAVAILABLE"],
    ["LLM_NETWORK_ERROR",503,"LLM_UNAVAILABLE"]
  ])("paper failure %s is classified, not INTERNAL_ERROR, and retry preserves the conversation",async(code,status,publicCode)=>{
    const store=new InMemoryWorkflowStore(),provider=new WorkflowMockProvider();
    const conversation=await store.createConversation("user-1");
    await store.appendMessage({ownerId:"user-1",conversationId:conversation.id,role:"user",generationStatus:"complete",content:"我还在做这件事，只是迟迟没有回应，不知道该怎么继续。"});
    const original=provider.completeJson.bind(provider);let shouldFail=true;
    provider.completeJson=async input=>{if(shouldFail)throw new LlmProviderError(String(code),"upstream diagnostic that must never be public");return original(input);};
    const app=createApp({config,runtime:new DiscoveryRuntime(config,undefined,()=>undefined),workflowStore:store,chatService:new ChatService(store,()=>provider),workflowService:new WorkflowService(store,()=>provider)});
    const path="/api/papers/drafts";
    const failed=await request(app).post(path).set(auth("POST",path)).set("Idempotency-Key","paper-failure-test-001").send({conversationId:conversation.id,confirmedProfile:null});
    expect(failed.status).toBe(status);expect(failed.body).toEqual({error:{code:publicCode}});
    expect(failed.text).not.toContain("diagnostic");
    expect(await store.listMessages(conversation.id,"user-1",12)).toHaveLength(1);
    shouldFail=false;
    const retry=await request(app).post(path).set(auth("POST",path)).set("Idempotency-Key","paper-failure-test-002").send({conversationId:conversation.id,confirmedProfile:null});
    expect(retry.status).toBe(201);expect(retry.body.data.status).toBe("draft");expect(retry.body.data.confirmedAt).toBeNull();
  });
  it("streams chat, creates an editable paper and enforces ownership",async()=>{
    const store=new InMemoryWorkflowStore(),create=()=>new WorkflowMockProvider();
    const app=createApp({config,runtime:new DiscoveryRuntime(config,undefined,()=>undefined),workflowStore:store,chatService:new ChatService(store,create),workflowService:new WorkflowService(store,create)});
    const chat=await request(app).post("/api/chat/reply").set(auth("POST","/api/chat/reply")).set("Idempotency-Key","workflow-chat-key-001").send({conversationId:null,message:"我写了很久，但一直没有人看。"});
    expect(chat.status).toBe(200);expect(chat.headers["content-type"]).toContain("text/event-stream");
    const done=event(chat.text,"done");expect(done.discovery.eligible).toBe(true);
    const draft=await request(app).post("/api/papers/drafts").set(auth("POST","/api/papers/drafts")).set("Idempotency-Key","workflow-paper-key-01").send({conversationId:done.conversationId,confirmedProfile:null});
    expect(draft.status).toBe(201);expect(draft.body.data).toMatchObject({status:"draft",version:1});
    const path=`/api/papers/${draft.body.data.id}`;
    await request(app).patch(path).set(auth("PATCH",path,"user-2")).set("Idempotency-Key","workflow-cross-key-01").send({expectedVersion:1,subject:"新的主题",quote:"我仍然想继续，只是没有回应时不知道怎样判断。",context:"持续投入 · 等待回声",background:"这个人持续投入一件重要的事，却迟迟没有得到足以判断下一步的回应。"}).expect(403);
    const edit=await request(app).patch(path).set(auth("PATCH",path)).set("Idempotency-Key","workflow-edit-key-001").send({expectedVersion:1,subject:"新的主题",quote:"我仍然想继续，只是没有回应时不知道怎样判断。",context:"持续投入 · 等待回声",background:"这个人持续投入一件重要的事，却迟迟没有得到足以判断下一步的回应。"});
    expect(edit.status).toBe(200);expect(edit.body.data.version).toBe(2);
  });
  it("does not consume a display on no-match, then records a real matched display",async()=>{
    const store=new InMemoryWorkflowStore(),create=()=>new WorkflowMockProvider(),chatService=new ChatService(store,create),workflowService=new WorkflowService(store,create);
    const bootstrap=createApp({config,runtime:new DiscoveryRuntime(config,undefined,()=>undefined),workflowStore:store,chatService,workflowService});
    const chat=await request(bootstrap).post("/api/chat/reply").set(auth("POST","/api/chat/reply")).set("Idempotency-Key","display-chat-key-0001").send({conversationId:null,message:"我还在写，但没有人看。"});
    const done=event(chat.text,"done"),path=`/api/conversations/${done.conversationId}/discovery`;
    const noMatch=discovery(false);const noMatchApp=createApp({config,runtime:{evaluateDetailed:async()=>({result:noMatch,trace:trace(noMatch.requestId)})},workflowStore:store,chatService,workflowService});
    await request(noMatchApp).post(path).set(auth("POST",path)).set("Idempotency-Key","display-no-match-0001").send({assistantMessageId:done.assistantMessageId,topicKey:done.discovery.topicKey}).expect(200);
    expect(await store.listTopicDisplays(done.conversationId,"user-1")).toHaveLength(0);
    const matched=discovery(true);const matchedApp=createApp({config,runtime:{evaluateDetailed:async()=>({result:matched,trace:trace(matched.requestId)})},workflowStore:store,chatService,workflowService});
    const response=await request(matchedApp).post(path).set(auth("POST",path)).set("Idempotency-Key","display-match-key-001").send({assistantMessageId:done.assistantMessageId,topicKey:done.discovery.topicKey});
    expect(response.status).toBe(200);expect(response.body.data.discoveryId).toMatch(/[0-9a-f-]{36}/);expect(await store.listTopicDisplays(done.conversationId,"user-1")).toHaveLength(1);
  });
});
function event(text:string,name:string){const match=text.match(new RegExp(`event: ${name}\\ndata: (.+)`));if(!match)throw new Error(`missing ${name}`);return JSON.parse(match[1]!);}
function trace(requestId:string){return{requestId,matchPolicy:null,stages:[],rejectedMatches:[]};}
function discovery(matched:boolean):DiscoveryResult{return{requestId:crypto.randomUUID(),status:matched?"matched":"no_match",shouldInvite:matched,understanding:{explicitConcerns:["写作没有读者"],uncertainPoints:["是否继续"]},matches:{situationClose:matched?{path:"situationClose",candidateId:"candidate-1",sharedRelation:"双方都在持续写作却迟迟没有等到读者",difference:"作品内容与具体生活背景并不相同",authorDisplayName:"匿名用户",profileBackground:["这个人一直在写作。"],recentFocus:null,sourceType:"authorized_private",contentType:"authorized_expression",sourceUrl:null,authorProfileUrl:"https://www.zhihu.com/people/example",publishedAt:new Date().toISOString(),timestampKind:"published",contactable:true,identityDisclosable:true,evidenceRefs:[{side:"user",refId:"u",quote:"没有人看"},{side:"candidate",refId:"c",quote:"没有读者"}]}:null,structureRelated:null},inviteCopy:matched?"还有一件事":null,presentationCopy:matched?{sharedConcern:"写了很久却没有读者时还要不要继续",choices:[{path:"situationClose",candidateId:"candidate-1",bridge:"我想到一个也还在写的人",relation:"你们都在没有读者时重新判断是否继续"}]}:null,reasonCode:matched?"supported_match_found":"no_displayable_candidates",dataMode:"routed",modelMode:"mock",meta:{pipelineVersion:"test",promptVersion:"test",matchPolicyVersion:"test",eligiblePrivatePoolSize:1,matchPolicyTier:"scarce",durationMs:1,candidateCount:matched?1:0}};}
