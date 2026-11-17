import { describe,expect,it } from "vitest";
import { ChatService } from "../src/chat/service.js";
import { WorkflowMockProvider } from "../src/llm/workflow-mock-provider.js";
import { InMemoryWorkflowStore } from "../src/workflow/store.js";
import { WorkflowService } from "../src/workflow/service.js";
import type { DiscoveryResult } from "../src/contracts/schemas.js";

const owner="11111111-1111-4111-8111-111111111111";
const other="22222222-2222-4222-8222-222222222222";

describe("chat, paper and handoff workflow",()=>{
  it("streams the answer, keeps finite context and records only confirmed displays",async()=>{
    const store=new InMemoryWorkflowStore();const service=new ChatService(store,()=>new WorkflowMockProvider());let text="";
    const first=await service.reply({ownerId:owner,conversationId:null,message:"我写了很久，却一直没有读者。",signal:new AbortController().signal,onChunk:c=>{text+=c;}});
    expect(text.length).toBeGreaterThan(20);expect(first.result.discovery.eligible).toBe(true);
    expect(await store.listTopicDisplays(first.result.conversationId,owner)).toEqual([]);
    await service.confirmDisplay({ownerId:owner,conversationId:first.result.conversationId,assistantMessageId:first.result.assistantMessageId,topicKey:first.result.discovery.topicKey!});
    expect(await store.listTopicDisplays(first.result.conversationId,owner)).toHaveLength(1);
    const second=await service.reply({ownerId:owner,conversationId:first.result.conversationId,message:"换个说法，我还是担心写了没人看。",signal:new AbortController().signal,onChunk:()=>{}});
    expect(second.result.discovery).toMatchObject({eligible:false,reasonCode:"same_topic_suppressed"});
  });

  it("locks a paper version, delivers only a contactable private target, then revokes it",async()=>{
    const store=new InMemoryWorkflowStore();const conversation=await store.createConversation(owner);
    await store.appendMessage({conversationId:conversation.id,ownerId:owner,role:"user",content:"我写了很久，还是没有人看见。",generationStatus:"complete"});
    await store.appendMessage({conversationId:conversation.id,ownerId:owner,role:"assistant",content:"你在等一个可以判断下一步的回声。",generationStatus:"complete"});
    const workflow=new WorkflowService(store,()=>new WorkflowMockProvider());
    const drafted=await workflow.draftPaper(owner,conversation.id,null,new AbortController().signal);
    const edited=await workflow.editPaper(owner,drafted.paper.id,1,{subject:"还要不要继续写",quote:"我仍然想写完它，只是没有人看见时，我越来越不知道这份重要还算不算数。",context:"持续写作 · 等待回声",background:"这个人持续写着一部对自己重要的作品；让他动摇的不是不想写，而是作品一直没有抵达别人。"});
    const recipient="33333333-3333-4333-8333-333333333333";
    const discovery=await store.saveDiscovery(owner,conversation.id,discoveryResult("authorized_private",true,null,"https://www.zhihu.com/people/example",recipient));
    const confirmed=await workflow.confirmPaper({ownerId:owner,id:edited.id,expectedVersion:edited.version,discoverableDays:7,identityDisclosure:"nickname",contactAllowed:true,target:{kind:"selected_private",discoveryId:discovery.id,candidateId:recipient}});
    expect(confirmed.paper).toMatchObject({status:"active",version:3});expect(confirmed.delivery?.status).toBe("delivered");
    const replay=await workflow.confirmPaper({ownerId:owner,id:edited.id,expectedVersion:edited.version,discoverableDays:7,identityDisclosure:"nickname",contactAllowed:true,target:{kind:"selected_private",discoveryId:discovery.id,candidateId:recipient}});
    expect(replay.delivery?.id).toBe(confirmed.delivery?.id);
    await expect(workflow.withdrawPaper(other,edited.id)).rejects.toMatchObject({code:"FORBIDDEN"});
    expect(await workflow.withdrawPaper(owner,edited.id)).toMatchObject({status:"withdrawn",version:4});
  });

  it("confirms the latest owner draft when the browser submits an older version",async()=>{
    const store=new InMemoryWorkflowStore();const conversation=await store.createConversation(owner);
    await store.appendMessage({conversationId:conversation.id,ownerId:owner,role:"user",content:"我还想继续写，只是一直没有人看见。",generationStatus:"complete"});
    const workflow=new WorkflowService(store,()=>new WorkflowMockProvider());
    const drafted=await workflow.draftPaper(owner,conversation.id,null,new AbortController().signal);
    const edited=await workflow.editPaper(owner,drafted.paper.id,drafted.paper.version,{subject:"继续写下去",quote:"我还想继续写，只是一直没有人看见，不知道是否应该坚持。",context:"写作与等待",background:"这个人仍然想把故事写完，只是长期没有读者回应，开始怀疑是否应该继续。"});

    const confirmed=await workflow.confirmPaper({ownerId:owner,id:edited.id,expectedVersion:drafted.paper.version,discoverableDays:7,identityDisclosure:"nickname",contactAllowed:true,target:{kind:"mailbox_only"}});

    expect(confirmed.paper).toMatchObject({status:"active",version:edited.version+1,quote:edited.quote});
    const replay=await workflow.confirmPaper({ownerId:owner,id:edited.id,expectedVersion:drafted.paper.version,discoverableDays:7,identityDisclosure:"nickname",contactAllowed:true,target:{kind:"mailbox_only"}});
    expect(replay.paper).toEqual(confirmed.paper);
  });

  it("allows one user to deposit separate papers with identical content",async()=>{
    const store=new InMemoryWorkflowStore();const conversation=await store.createConversation(owner);
    const shared={ownerId:owner,conversationId:conversation.id,subject:"同一件事",quote:"我仍然想继续，只是暂时没有等到任何回应。",context:"等待回应",background:"这是用户主动留下的一段近况；重复投递不应被当成数据库冲突。"};
    const first=await store.createPaperDraft(shared),second=await store.createPaperDraft(shared);
    const workflow=new WorkflowService(store,()=>new WorkflowMockProvider());

    const a=await workflow.confirmPaper({ownerId:owner,id:first.id,expectedVersion:first.version,discoverableDays:7,identityDisclosure:"nickname",contactAllowed:true,target:{kind:"mailbox_only"}});
    const b=await workflow.confirmPaper({ownerId:owner,id:second.id,expectedVersion:second.version,discoverableDays:7,identityDisclosure:"nickname",contactAllowed:true,target:{kind:"mailbox_only"}});

    expect(a.paper.id).not.toBe(b.paper.id);expect(a.paper.status).toBe("active");expect(b.paper.status).toBe("active");
  });

  it("keeps an old non-UUID private fixture on the synthetic conversation path",async()=>{
    const store=new InMemoryWorkflowStore();const conversation=await store.createConversation(owner);
    const paper=await store.createPaperDraft({ownerId:owner,conversationId:conversation.id,subject:"等待回声",quote:"我还在继续，只是很久没有等到任何人的回应。",context:"持续创作",background:"这个人持续做着一件重要的事，但一直缺少来自他人的具体反馈。"});
    const discovery=await store.saveDiscovery(owner,conversation.id,discoveryResult("authorized_private",true,null,null,"music-no-echo"));
    const workflow=new WorkflowService(store,()=>new WorkflowMockProvider());

    const result=await workflow.confirmPaper({ownerId:owner,id:paper.id,expectedVersion:paper.version,discoverableDays:7,identityDisclosure:"nickname",contactAllowed:true,target:{kind:"selected_private",discoveryId:discovery.id,candidateId:"music-no-echo"}});

    expect(result).toMatchObject({paper:{status:"active",contactAllowed:false},delivery:null});
  });

  it("returns only a verified Zhihu destination and never transfers typed text",async()=>{
    const store=new InMemoryWorkflowStore();const conversation=await store.createConversation(owner);const workflow=new WorkflowService(store,()=>new WorkflowMockProvider());
    const publicDiscovery=await store.saveDiscovery(owner,conversation.id,discoveryResult("public",false,"https://www.zhihu.com/question/1/answer/2",null));
    expect(await workflow.handoff(owner,publicDiscovery.id,"candidate-1")).toEqual({redirectUrl:"https://www.zhihu.com/question/1/answer/2",textTransferred:false,deliveryClaimed:false,notice:"前往知乎继续；输入文字不会自动发送。"});
    const synthetic=await store.saveDiscovery(owner,conversation.id,discoveryResult("synthetic_private",false,null,null));
    await expect(workflow.handoff(owner,synthetic.id,"candidate-1")).rejects.toMatchObject({code:"HANDOFF_UNAVAILABLE"});
  });
});

function discoveryResult(sourceType:"public"|"authorized_private"|"synthetic_private",contactable:boolean,sourceUrl:string|null,authorProfileUrl:string|null,candidateId="candidate-1"):DiscoveryResult{
  return {requestId:crypto.randomUUID(),status:"matched",shouldInvite:true,understanding:{explicitConcerns:["没有回声"],uncertainPoints:["是否继续"]},matches:{situationClose:{path:"situationClose",candidateId,sharedRelation:"双方都在长期投入后等待具体回声",difference:"两个人面对的具体事情与生活背景并不相同",authorDisplayName:"对方",profileBackground:[],recentFocus:null,sourceType,contentType:sourceType==="public"?"answer":"authorized_expression",sourceUrl,authorProfileUrl,publishedAt:new Date().toISOString(),timestampKind:sourceType==="synthetic_private"?"sample_created":"published",contactable,identityDisclosable:true,evidenceRefs:[{side:"user",refId:"u1",quote:"没有人看见"},{side:"candidate",refId:"c1",quote:"一直没有回应"}]},structureRelated:null},inviteCopy:"还有一件事",presentationCopy:{sharedConcern:"投入很久却迟迟没有回声时怎样判断下一步",choices:[{path:"situationClose",candidateId,bridge:"我想到一个也在等待回声的人",relation:"事情不同，但都在等待能够判断下一步的具体回应"}]},reasonCode:"supported_match_found",dataMode:"routed",modelMode:"mock",meta:{pipelineVersion:"test",promptVersion:"test",matchPolicyVersion:"test",eligiblePrivatePoolSize:1,matchPolicyTier:"scarce",durationMs:1,candidateCount:1}};
}
