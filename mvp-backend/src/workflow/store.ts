import { randomUUID } from "node:crypto";
import type { DiscoveryResult } from "../contracts/schemas.js";
import type { ConversationStore } from "../chat/store.js";
import { BusinessStoreError, InMemoryConversationStore } from "../chat/store.js";
import type { StoredDelivery, StoredDiscovery, StoredPaper } from "./contracts.js";

export interface WorkflowStore extends ConversationStore {
  saveDiscovery(ownerId: string, conversationId: string, result: DiscoveryResult): Promise<StoredDiscovery>;
  getDiscovery(id: string, ownerId: string): Promise<StoredDiscovery>;
  createPaperDraft(input: Omit<StoredPaper, "id" | "version" | "status" | "discoverableUntil" | "identityDisclosure" | "contactAllowed" | "confirmedAt" | "withdrawnAt" | "createdAt" | "updatedAt">): Promise<StoredPaper>;
  getPaper(id: string, ownerId: string): Promise<StoredPaper>;
  editPaper(id: string, ownerId: string, expectedVersion: number, fields: Pick<StoredPaper,"subject"|"quote"|"context"|"background">): Promise<StoredPaper>;
  confirmPaper(input: { id: string; ownerId: string; expectedVersion: number; discoverableUntil: string; identityDisclosure: "anonymous"|"nickname"; contactAllowed: boolean }): Promise<StoredPaper>;
  confirmPaperAndDeliver(input: { id:string;ownerId:string;expectedVersion:number;discoverableUntil:string;identityDisclosure:"anonymous"|"nickname";contactAllowed:boolean;discoveryId:string;candidateId:string }): Promise<{paper:StoredPaper;delivery:StoredDelivery}>;
  withdrawPaper(id: string, ownerId: string): Promise<StoredPaper>;
  createDelivery(input: Omit<StoredDelivery,"id"|"createdAt"|"status">): Promise<StoredDelivery>;
}

export class InMemoryWorkflowStore extends InMemoryConversationStore implements WorkflowStore {
  private discoveries = new Map<string, StoredDiscovery>();
  private papers = new Map<string, StoredPaper>();
  private deliveries = new Map<string, StoredDelivery>();

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
  async confirmPaper(input: { id:string; ownerId:string; expectedVersion:number; discoverableUntil:string; identityDisclosure:"anonymous"|"nickname"; contactAllowed:boolean }) {
    const current = this.papers.get(input.id); if (!current) throw new BusinessStoreError("NOT_FOUND");
    if (current.ownerId !== input.ownerId) throw new BusinessStoreError("FORBIDDEN");
    if (current.status === "active" && current.version === input.expectedVersion + 1) return structuredClone(current);
    if (current.status !== "draft" || current.version !== input.expectedVersion) throw new BusinessStoreError("CONFLICT");
    const now = new Date().toISOString(); Object.assign(current, { status:"active" as const, version:current.version+1,
      discoverableUntil:input.discoverableUntil, identityDisclosure:input.identityDisclosure, contactAllowed:input.contactAllowed,
      confirmedAt:now, updatedAt:now }); return structuredClone(current);
  }
  async confirmPaperAndDeliver(input:{id:string;ownerId:string;expectedVersion:number;discoverableUntil:string;identityDisclosure:"anonymous"|"nickname";contactAllowed:boolean;discoveryId:string;candidateId:string}) {
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
    if (current.status !== "active") throw new BusinessStoreError("CONFLICT");
    const now = new Date().toISOString(); Object.assign(current,{status:"withdrawn" as const,version:current.version+1,withdrawnAt:now,updatedAt:now});
    return structuredClone(current);
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
