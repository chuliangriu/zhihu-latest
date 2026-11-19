import { randomUUID } from "node:crypto";
import type { DiscoveryResult } from "../contracts/schemas.js";
import type { ConversationStore } from "../chat/store.js";
import { BusinessStoreError, InMemoryConversationStore } from "../chat/store.js";
import type { DiscussionView, MatchedPaperView, StoredDelivery, StoredDiscovery, StoredPaper } from "./contracts.js";

export interface WorkflowStore extends ConversationStore {
  listPapers(ownerId:string): Promise<StoredPaper[]>;
  listConversations(ownerId:string): Promise<import("../chat/contracts.js").StoredConversation[]>;
  conversationHistory(id:string,ownerId:string): Promise<import("../chat/contracts.js").StoredMessage[]>;
  hasConfirmedPaper(ownerId:string): Promise<boolean>;
  readMatchedPaper(ownerId:string,discoveryId:string,candidateId:string): Promise<MatchedPaperView>;
  openDiscussion(ownerId:string,discoveryId:string,candidateId:string): Promise<DiscussionView>;
  listDiscussions(ownerId:string): Promise<DiscussionView[]>;
  getDiscussion(id:string,ownerId:string): Promise<DiscussionView>;
  replyDiscussion(id:string,ownerId:string,content:string,clientMessageId:string): Promise<DiscussionView>;

  saveDiscovery(ownerId: string, conversationId: string, result: DiscoveryResult): Promise<StoredDiscovery>;
  getDiscovery(id: string, ownerId: string): Promise<StoredDiscovery>;
  createPaperDraft(input: Omit<StoredPaper, "id" | "version" | "status" | "discoverableUntil" | "identityDisclosure" | "contactAllowed" | "confirmedAt" | "withdrawnAt" | "createdAt" | "updatedAt">): Promise<StoredPaper>;
  getPaper(id: string, ownerId: string): Promise<StoredPaper>;
  editPaper(id: string, ownerId: string, expectedVersion: number, fields: Pick<StoredPaper,"subject"|"quote"|"context"|"background">): Promise<StoredPaper>;
  confirmPaper(input: { id: string; ownerId: string; expectedVersion: number; discoverableUntil: string; identityDisclosure: "anonymous"|"nickname"; contactAllowed: boolean; matchingAllowed?: boolean }): Promise<StoredPaper>;
  confirmPaperAndDeliver(input: { id:string;ownerId:string;expectedVersion:number;discoverableUntil:string;identityDisclosure:"anonymous"|"nickname";contactAllowed:boolean;matchingAllowed?:boolean;discoveryId:string;candidateId:string }): Promise<{paper:StoredPaper;delivery:StoredDelivery}>;
  withdrawPaper(id: string, ownerId: string): Promise<StoredPaper>;
  createDelivery(input: Omit<StoredDelivery,"id"|"createdAt"|"status">): Promise<StoredDelivery>;
}

export class InMemoryWorkflowStore extends InMemoryConversationStore implements WorkflowStore {
  private discoveries = new Map<string, StoredDiscovery>();
  private papers = new Map<string, StoredPaper>();
  private deliveries = new Map<string, StoredDelivery>();
  private threads = new Map<string,{id:string;paperId:string;introductionId:string;authorId:string;readerId:string;createdAt:string;updatedAt:string;messages:Array<{id:string;senderId:string;content:string;clientMessageId:string;createdAt:string}>}>();

  async saveDiscovery(ownerId: string, conversationId: string, result: DiscoveryResult) {
    await this.getConversation(conversationId, ownerId);
    const createdAt = new Date().toISOString();
    const candidates = Object.values(result.matches).filter(x => x !== null).map(match => ({
      candidateId: match.candidateId, path: match.path, sourceType: match.sourceType, sourceUrl: match.sourceUrl,
      authorProfileUrl: match.authorProfileUrl, contactable: match.contactable, publishedAt: match.publishedAt,
      excerptSnapshot: match.evidenceRefs.find(x => x.side === "candidate")?.quote ?? "",
      relationSnapshot: match.sharedRelation
    }));
    const value: StoredDiscovery = { id: randomUUID(), ownerId, conversationId, pipelineRequestId: result.requestId,
      candidates, createdAt, expiresAt: new Date(Date.now()+7*86_400_000).toISOString() };
    this.discoveries.set(value.id, value); return structuredClone(value);
  }
  async getDiscovery(id: string, ownerId: string) {
    const value = this.discoveries.get(id);
    if (!value) throw new BusinessStoreError("NOT_FOUND");
    if (value.ownerId !== ownerId) throw new BusinessStoreError("FORBIDDEN");
    if (Date.parse(value.expiresAt) <= Date.now()) throw new BusinessStoreError("NOT_FOUND");
    return structuredClone(value);
  }
  async createPaperDraft(input: Omit<StoredPaper,"id"|"version"|"status"|"discoverableUntil"|"identityDisclosure"|"contactAllowed"|"confirmedAt"|"withdrawnAt"|"createdAt"|"updatedAt">) {
    await this.getConversation(input.conversationId, input.ownerId);
    const now = new Date().toISOString();
    const value: StoredPaper = { ...input, id: randomUUID(), version: 1, status: "draft", discoverableUntil: null,
      identityDisclosure: "anonymous", contactAllowed: false, confirmedAt: null, withdrawnAt: null, createdAt: now, updatedAt: now };
    this.papers.set(value.id,value); return structuredClone(value);
  }
  async getPaper(id: string, ownerId: string) {
    const value = this.papers.get(id); if (!value) throw new BusinessStoreError("NOT_FOUND");
    if (value.ownerId !== ownerId) throw new BusinessStoreError("FORBIDDEN");
    if (value.status === "active" && value.discoverableUntil && Date.parse(value.discoverableUntil) <= Date.now()) value.status = "expired";
    return structuredClone(value);
  }
  async editPaper(id: string, ownerId: string, expectedVersion: number, fields: Pick<StoredPaper,"subject"|"quote"|"context"|"background">) {
    const current = this.papers.get(id); if (!current) throw new BusinessStoreError("NOT_FOUND");
    if (current.ownerId !== ownerId) throw new BusinessStoreError("FORBIDDEN");
    if (current.status !== "draft" || current.version !== expectedVersion) throw new BusinessStoreError("CONFLICT");
    Object.assign(current, fields, { version: current.version + 1, updatedAt: new Date().toISOString() });
    return structuredClone(current);
  }
  async confirmPaper(input: { id:string; ownerId:string; expectedVersion:number; discoverableUntil:string; identityDisclosure:"anonymous"|"nickname"; contactAllowed:boolean; matchingAllowed?:boolean }) {
    const current = this.papers.get(input.id); if (!current) throw new BusinessStoreError("NOT_FOUND");
    if (current.ownerId !== input.ownerId) throw new BusinessStoreError("FORBIDDEN");
    if (current.status === "active" && current.version === input.expectedVersion + 1) return structuredClone(current);
    if (current.status !== "draft" || current.version !== input.expectedVersion) throw new BusinessStoreError("CONFLICT");
    const now = new Date().toISOString(); Object.assign(current, { status:"active" as const, version:current.version+1,
      discoverableUntil:input.discoverableUntil, identityDisclosure:input.identityDisclosure, contactAllowed:input.contactAllowed,
      confirmedAt:now, updatedAt:now, expressionId: randomUUID(), matchingAllowed:input.matchingAllowed??true }); return structuredClone(current);
  }
  async confirmPaperAndDeliver(input:{id:string;ownerId:string;expectedVersion:number;discoverableUntil:string;identityDisclosure:"anonymous"|"nickname";contactAllowed:boolean;matchingAllowed?:boolean;discoveryId:string;candidateId:string}) {
    const discovery=await this.getDiscovery(input.discoveryId,input.ownerId);
    const candidate=discovery.candidates.find(x=>x.candidateId===input.candidateId);
    if(!candidate||candidate.sourceType!=="authorized_private"||!candidate.contactable)throw new BusinessStoreError("CONFLICT");
    const paper=await this.confirmPaper(input);
    const delivery=await this.createDelivery({paperId:paper.id,paperVersion:paper.version,senderId:input.ownerId,discoveryId:input.discoveryId,candidateId:input.candidateId});
    return {paper,delivery};
  }
  async withdrawPaper(id:string, ownerId:string) {
    const current = this.papers.get(id); if (!current) throw new BusinessStoreError("NOT_FOUND");
    if (current.ownerId !== ownerId) throw new BusinessStoreError("FORBIDDEN");
    if (current.status === "withdrawn") return structuredClone(current);
    if (!["active","expired"].includes(current.status)) throw new BusinessStoreError("CONFLICT");
    const now = new Date().toISOString(); Object.assign(current,{status:"withdrawn" as const,version:current.version+1,withdrawnAt:now,updatedAt:now});
    return structuredClone(current);
  }
  async listPapers(ownerId:string) {
    return Promise.all([...this.papers.values()].filter(p=>p.ownerId===ownerId).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)).slice(0,50).map(p=>this.getPaper(p.id,ownerId)));
  }
  async listConversations(ownerId:string) { return this.ownerConversations(ownerId); }
  async conversationHistory(id:string,ownerId:string) { return this.listMessages(id,ownerId,100); }
  async hasConfirmedPaper(ownerId:string) { return [...this.papers.values()].some(p=>p.ownerId===ownerId&&p.confirmedAt&&p.status!=="withdrawn"); }
  private preview(p:StoredPaper,viewer:string):DiscussionView["paper"] {
    const withdrawn=p.status==="withdrawn";
    return {id:p.id,status:withdrawn?"withdrawn":p.discoverableUntil&&Date.parse(p.discoverableUntil)<=Date.now()?"expired":"active",
      subject:withdrawn?"已撤回的纸条":p.subject,quote:withdrawn?null:p.quote,background:withdrawn?null:p.background,
      displayName:p.ownerId===viewer?"你":"匿名用户",own:p.ownerId===viewer};
  }
  async readMatchedPaper(ownerId:string,discoveryId:string,candidateId:string):Promise<MatchedPaperView> {
    const discovery=await this.getDiscovery(discoveryId,ownerId),candidate=discovery.candidates.find(c=>c.candidateId===candidateId&&c.sourceType==="authorized_private");
    if(!candidate)throw new BusinessStoreError("NOT_FOUND");
    const paper=[...this.papers.values()].find(p=>p.expressionId===candidateId&&p.ownerId!==ownerId);
    if(!paper)throw new BusinessStoreError("NOT_FOUND");
    const thread=[...this.threads.values()].find(t=>t.paperId===paper.id&&t.readerId===ownerId);
    const active=paper.status==="active"&&paper.matchingAllowed!==false&&paper.discoverableUntil&&Date.parse(paper.discoverableUntil)>Date.now()&&Date.now()-Date.parse(paper.confirmedAt??paper.createdAt)<7*86400000;
    const status=paper.status==="withdrawn"?"withdrawn":active?"active":"expired";
    return {status,paper:status==="active"||thread?this.preview(paper,ownerId):null,contactable:Boolean(active&&paper.contactAllowed),discussionId:thread?.id??null};
  }
  async openDiscussion(ownerId:string,discoveryId:string,candidateId:string) {
    const view=await this.readMatchedPaper(ownerId,discoveryId,candidateId);
    if(view.discussionId)return this.getDiscussion(view.discussionId,ownerId);
    if(view.status!=="active"||!view.contactable||!view.paper)throw new BusinessStoreError("CONFLICT");
    const own=[...this.papers.values()].filter(p=>p.ownerId===ownerId&&p.confirmedAt&&p.status!=="withdrawn"&&p.contactAllowed).sort((a,b)=>b.confirmedAt!.localeCompare(a.confirmedAt!))[0];
    if(!own)throw new MailboxRuleError("OWN_PAPER_REQUIRED");
    const paper=this.papers.get(view.paper.id)!;
    // No await between rechecking state and inserting: this mirrors the SQL transaction.
    if(paper.status==="withdrawn"||own.status==="withdrawn")throw new BusinessStoreError("CONFLICT");
    const existing=[...this.threads.values()].find(t=>t.paperId===paper.id&&t.readerId===ownerId);
    if(existing)return this.getDiscussion(existing.id,ownerId);
    const now=new Date().toISOString(),id=randomUUID();
    this.threads.set(id,{id,paperId:paper.id,introductionId:own.id,authorId:paper.ownerId,readerId:ownerId,createdAt:now,updatedAt:now,messages:[]});
    return this.getDiscussion(id,ownerId);
  }
  async listDiscussions(ownerId:string) {
    return Promise.all([...this.threads.values()].filter(t=>t.authorId===ownerId||t.readerId===ownerId).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)).slice(0,50).map(t=>this.getDiscussion(t.id,ownerId)));
  }
  async getDiscussion(id:string,ownerId:string):Promise<DiscussionView> {
    const t=this.threads.get(id);if(!t||![t.authorId,t.readerId].includes(ownerId))throw new BusinessStoreError("NOT_FOUND");
    const p=this.papers.get(t.paperId)!,intro=this.papers.get(t.introductionId)!;
    const withdrawn=p.status==="withdrawn"||intro.status==="withdrawn",contact=p.contactAllowed&&intro.contactAllowed;
    return {id:t.id,paper:this.preview(p,ownerId),introduction:this.preview(intro,ownerId),canReply:!withdrawn&&contact,
      closedReason:withdrawn?"paper_withdrawn":contact?null:"contact_disabled",createdAt:t.createdAt,updatedAt:t.updatedAt,
      messages:t.messages.map(m=>({id:m.id,own:m.senderId===ownerId,content:m.content,createdAt:m.createdAt}))};
  }
  async replyDiscussion(id:string,ownerId:string,content:string,clientMessageId:string) {
    const view=await this.getDiscussion(id,ownerId),thread=this.threads.get(id)!;
    const existing=thread.messages.find(m=>m.senderId===ownerId&&m.clientMessageId===clientMessageId);
    if(existing){if(existing.content!==content)throw new BusinessStoreError("CONFLICT");return this.getDiscussion(id,ownerId);}
    if(!view.canReply)throw new MailboxRuleError("DISCUSSION_CLOSED");
    if(!await this.hasConfirmedPaper(ownerId))throw new MailboxRuleError("OWN_PAPER_REQUIRED");
    const now=new Date().toISOString();
    // Recheck withdrawal after the asynchronous ownership check.
    if(this.papers.get(thread.paperId)!.status==="withdrawn"||this.papers.get(thread.introductionId)!.status==="withdrawn")throw new MailboxRuleError("DISCUSSION_CLOSED");
    const duplicate=thread.messages.find(m=>m.senderId===ownerId&&m.clientMessageId===clientMessageId);
    if(duplicate){if(duplicate.content!==content)throw new BusinessStoreError("CONFLICT");return this.getDiscussion(id,ownerId);}
    thread.messages.push({id:randomUUID(),senderId:ownerId,content,clientMessageId,createdAt:now});thread.updatedAt=now;
    return this.getDiscussion(id,ownerId);
  }
  async createDelivery(input: Omit<StoredDelivery,"id"|"createdAt"|"status">) {
    const paper = await this.getPaper(input.paperId,input.senderId);
    if (paper.status !== "active" || paper.version !== input.paperVersion) throw new BusinessStoreError("CONFLICT");
    const discovery = await this.getDiscovery(input.discoveryId,input.senderId);
    const candidate = discovery.candidates.find(x => x.candidateId === input.candidateId);
    if (!candidate || candidate.sourceType !== "authorized_private" || !candidate.contactable) throw new BusinessStoreError("CONFLICT");
    const key = `${input.paperId}:${input.paperVersion}:${input.discoveryId}:${input.candidateId}`;
    const existing = this.deliveries.get(key); if (existing) return structuredClone(existing);
    const value: StoredDelivery = { ...input,id:randomUUID(),status:"delivered",createdAt:new Date().toISOString() };
    this.deliveries.set(key,value); return structuredClone(value);
  }
}

export class MailboxRuleError extends Error { constructor(public readonly code:"OWN_PAPER_REQUIRED"|"DISCUSSION_CLOSED"|"MAILBOX_SETUP_REQUIRED"){super(code);} }
