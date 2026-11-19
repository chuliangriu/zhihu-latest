import type { DiscoveryResult } from "../contracts/schemas.js";
import type { LlmProvider, LlmUsage } from "../llm/provider.js";
import { containsForbiddenModelArtifact, scanConversationForPromptInjection } from "../security/prompt-injection.js";
import { isZhihuUrl } from "../guards/candidates.js";
import { OWN_PAPER_SYSTEM_PROMPT } from "../prompts/own-paper.js";
import { ownPaperModelSchema } from "./contracts.js";
import { MailboxRuleError } from "./store.js";
import type { WorkflowStore } from "./store.js";

export class WorkflowService {
  constructor(private readonly store: WorkflowStore, private readonly createLlm: () => LlmProvider) {}

  async saveDiscovery(ownerId: string, conversationId: string, result: DiscoveryResult) {
    if (result.status !== "matched") return null;
    return this.store.saveDiscovery(ownerId,conversationId,result);
  }

  async draftPaper(ownerId:string, conversationId:string, confirmedProfile: {background:string[];recentFocus:string|null}|null, signal:AbortSignal) {
    const messages = (await this.store.listMessages(conversationId,ownerId,18)).filter(x => x.generationStatus === "complete").slice(-12);
    if (!messages.some(x => x.role === "user")) throw new WorkflowServiceError("PAPER_EVIDENCE_MISSING");
    const conversation = { messages: messages.map(x => ({id:x.id,role:x.role,content:x.content})) };
    if (scanConversationForPromptInjection(conversation).length) throw new WorkflowServiceError("PROMPT_INJECTION_BLOCKED");
    if(confirmedProfile&&scanConversationForPromptInjection({messages:[{id:"confirmed-profile",role:"user",content:[...confirmedProfile.background,confirmedProfile.recentFocus??""].join("\n")}]}).length)throw new WorkflowServiceError("PROMPT_INJECTION_BLOCKED");
    const completion = await this.createLlm().completeJson({ task:"own_paper_draft",systemPrompt:OWN_PAPER_SYSTEM_PROMPT,
      payload:{ userMessages:messages.filter(x=>x.role==="user").map(({id,content})=>({id,content})),confirmedProfile },
      schema:ownPaperModelSchema,signal });
    let fields = completion.data;
    if (containsForbiddenModelArtifact(Object.values(fields)) || /[<>\r]/u.test(Object.values(fields).join(""))) throw new WorkflowServiceError("MODEL_OUTPUT_REJECTED");
    const evidenceText=[...messages.filter(x=>x.role==="user").map(x=>x.content),...(confirmedProfile?.background??[]),confirmedProfile?.recentFocus??""].join("\n");
    if(hasUnsupportedSpecifics(Object.values(fields).join("\n"),evidenceText)){
      fields=createGroundedPaperFallback(messages.filter(x=>x.role==="user").map(x=>x.content));
    }
    const paper = await this.store.createPaperDraft({ownerId,conversationId,...fields});
    return { paper, usage: completion.usage };
  }

  async editPaper(ownerId:string,id:string,expectedVersion:number,fields:{subject:string;quote:string;context:string;background:string}) {
    if (containsForbiddenModelArtifact(Object.values(fields))||/[<>\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(Object.values(fields).join(""))) throw new WorkflowServiceError("PAPER_CONTENT_REJECTED");
    return this.store.editPaper(id,ownerId,expectedVersion,fields);
  }

  async confirmPaper(input:{ownerId:string;id:string;expectedVersion:number;discoverableDays:number;identityDisclosure:"anonymous"|"nickname";contactAllowed:boolean;matchingAllowed?:boolean;target:{kind:"mailbox_only"}|{kind:"selected_private";discoveryId:string;candidateId:string}|{kind:"synthetic_demo";discoveryId:string;candidateId:string}}) {
    let discovery;
    let fixturePrivate=false;
    if (input.target.kind === "selected_private" || input.target.kind === "synthetic_demo") {
      const target = input.target;
      discovery = await this.store.getDiscovery(target.discoveryId,input.ownerId);
      const candidate = discovery.candidates.find(x=>x.candidateId===target.candidateId);
      fixturePrivate=input.target.kind==="selected_private"&&candidate?.sourceType==="authorized_private"&&!isUuid(candidate.candidateId);
      if (!candidate || (input.target.kind === "selected_private" ? !fixturePrivate&&(candidate.sourceType !== "authorized_private" || !candidate.contactable) : candidate.sourceType !== "synthetic_private")) throw new WorkflowServiceError("TARGET_NOT_DELIVERABLE");
    }
    // Confirmation does not edit paper content. Refresh the owner-scoped paper
    // first so a completed edit (or a lost confirmation response) cannot leave
    // the browser stuck with an obsolete version number.
    const current=await this.store.getPaper(input.id,input.ownerId);
    const expectedVersion=current.status==="active"?current.version-1:current.version;
    const common={id:input.id,ownerId:input.ownerId,expectedVersion,
      discoverableUntil:new Date(Date.now()+input.discoverableDays*86_400_000).toISOString(),identityDisclosure:input.identityDisclosure,contactAllowed:input.contactAllowed,matchingAllowed:input.matchingAllowed??true};
    if(input.target.kind==="selected_private"&&!fixturePrivate){
      const result=await this.store.confirmPaperAndDeliver({...common,discoveryId:input.target.discoveryId,candidateId:input.target.candidateId});
      // A confirmed delivery must be visible in the recipient's mailbox even
      // when the sender leaves this page without opening the discussion.
      // The existing open RPC is idempotent; a retry after either commit is safe.
      await this.store.openDiscussion(input.ownerId,input.target.discoveryId,input.target.candidateId);
      return result;
    }
    if(input.target.kind==="synthetic_demo"||fixturePrivate)return {paper:await this.store.confirmPaper({...common,contactAllowed:false}),delivery:null};
    return {paper:await this.store.confirmPaper(common),delivery:null};
  }

  async handoff(ownerId:string,discoveryId:string,candidateId:string) {
    const discovery = await this.store.getDiscovery(discoveryId,ownerId);
    const candidate = discovery.candidates.find(x=>x.candidateId===candidateId);
    if (!candidate || candidate.sourceType === "synthetic_private") throw new WorkflowServiceError("HANDOFF_UNAVAILABLE");
    if(candidate.sourceType!=="public")throw new WorkflowServiceError("HANDOFF_UNAVAILABLE");
    if(!await this.store.hasConfirmedPaper(ownerId))throw new MailboxRuleError("OWN_PAPER_REQUIRED");
    const redirectUrl = candidate.sourceType === "public" ? candidate.sourceUrl : candidate.authorProfileUrl;
    const safeUrl=redirectUrl?normalizeHandoffUrl(redirectUrl):null;
    if (!safeUrl) throw new WorkflowServiceError("HANDOFF_URL_UNAVAILABLE");
    return {redirectUrl:safeUrl,textTransferred:false,deliveryClaimed:false,notice:"前往知乎继续；输入文字不会自动发送。"};
  }

  async withdrawPaper(ownerId:string,id:string){return this.store.withdrawPaper(id,ownerId);}
}

export class WorkflowServiceError extends Error { constructor(public readonly code:string){super(code);} }
export function usageTrace(name:string,usage:LlmUsage){return {requestId:randomUUID(),matchPolicy:null,stages:[{name,durationMs:0,usage}],rejectedMatches:[]};}
function normalizeHandoffUrl(value:string){if(!isZhihuUrl(value))return null;const url=new URL(value);const allowed=url.hostname==="zhuanlan.zhihu.com"?/^\/p\/\d+\/?$/u.test(url.pathname):url.pathname==="/"||/^\/(?:people\/[A-Za-z0-9_-]+|answer\/\d+|question\/\d+(?:\/answer\/\d+)?|pin\/\d+)\/?$/u.test(url.pathname);return allowed?`${url.origin}${url.pathname}`:null;}
function isUuid(value:string){return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value);}
export function hasUnsupportedSpecifics(output:string,evidence:string){const terms=["创作","写作","小说","工作","项目","学校","社团","家庭","关系","健康","投资","建筑","设计","音乐","绘画"];
  // Exact semantic equivalents are not new biographical facts. Keep identity
  // fields strict: e.g. "下班" still cannot become a specific job or project.
  const equivalents:Record<string,RegExp>={"绘画":/画画|画插画|插画|画漫画|绘画/u,"创作":/创作|写小说|写作|画画|画插画|插画|作曲/u,"写作":/写作|写小说|写文章/u};
  if(terms.some(term=>output.includes(term)&&!evidence.includes(term)&&!equivalents[term]?.test(evidence)))return true;
  const concrete=[...(output.matchAll(/《[^》]{1,40}》|\b\d+(?:\.\d+)?\b/gu))].map(x=>x[0]);return concrete.some(value=>!evidence.includes(value));}
export function createGroundedPaperFallback(userMessages:string[]){
  const normalized=userMessages.map(value=>value.replace(/[<>\r\n\u0000-\u001f]/gu," ").replace(/\s+/gu," ").trim()).filter(Boolean);
  const latestSubstantial=[...normalized].reverse().find(value=>value.length>=8)??normalized.at(-1)??"";
  const quote=(latestSubstantial.length>=8?latestSubstantial:`我刚才提到：“${latestSubstantial||"这件事"}”`).slice(0,100).trim();
  return ownPaperModelSchema.parse({
    subject:"刚才聊到的事",
    quote,
    context:"来自刚才的对话",
    background:"具体背景以本人刚才的原话为准。"
  });
}
import { randomUUID } from "node:crypto";
