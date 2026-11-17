import { randomUUID } from "node:crypto";
import type { TopicAssessment, StoredConversation, StoredMessage, StoredTopicDisplay } from "./contracts.js";

export class BusinessStoreError extends Error {
  constructor(public readonly code: "NOT_FOUND" | "FORBIDDEN" | "CONFLICT" | "UNAVAILABLE") { super(code); }
}

export interface ConversationStore {
  createConversation(ownerId: string): Promise<StoredConversation>;
  getConversation(conversationId: string, ownerId: string): Promise<StoredConversation>;
  listMessages(conversationId: string, ownerId: string, limit: number): Promise<StoredMessage[]>;
  appendMessage(input: Omit<StoredMessage, "id" | "createdAt">): Promise<StoredMessage>;
  finishMessage(messageId: string, ownerId: string, content: string, status: "complete" | "failed"): Promise<StoredMessage>;
  saveTopicAssessment(conversationId: string, ownerId: string, assistantMessageId: string, assessment: TopicAssessment): Promise<void>;
  getTopicAssessment(conversationId: string, ownerId: string, assistantMessageId: string): Promise<TopicAssessment | null>;
  listTopicDisplays(conversationId: string, ownerId: string): Promise<StoredTopicDisplay[]>;
  markTopicDisplayed(conversationId: string, ownerId: string, assistantMessageId: string, topicKey: string): Promise<StoredTopicDisplay>;
}

export class InMemoryConversationStore implements ConversationStore {
  private conversations = new Map<string, StoredConversation>();
  private messages = new Map<string, StoredMessage>();
  private assessments = new Map<string, TopicAssessment>();
  private displays = new Map<string, StoredTopicDisplay>();

  async createConversation(ownerId: string) {
    const now = new Date().toISOString();
    const value = { id: randomUUID(), ownerId, createdAt: now, updatedAt: now };
    this.conversations.set(value.id, value);
    return structuredClone(value);
  }

  async getConversation(conversationId: string, ownerId: string) {
    const value = this.conversations.get(conversationId);
    if (!value) throw new BusinessStoreError("NOT_FOUND");
    if (value.ownerId !== ownerId) throw new BusinessStoreError("FORBIDDEN");
    return structuredClone(value);
  }

  async listMessages(conversationId: string, ownerId: string, limit: number) {
    await this.getConversation(conversationId, ownerId);
    return [...this.messages.values()].filter(x => x.conversationId === conversationId && x.ownerId === ownerId)
      .sort((a,b) => a.createdAt.localeCompare(b.createdAt)).slice(-limit).map(x => structuredClone(x));
  }

  async appendMessage(input: Omit<StoredMessage, "id" | "createdAt">) {
    await this.getConversation(input.conversationId, input.ownerId);
    const value: StoredMessage = { ...input, id: randomUUID(), createdAt: new Date().toISOString() };
    this.messages.set(value.id, value);
    const conversation = this.conversations.get(input.conversationId)!;
    conversation.updatedAt = value.createdAt;
    return structuredClone(value);
  }

  async finishMessage(messageId: string, ownerId: string, content: string, status: "complete" | "failed") {
    const value = this.messages.get(messageId);
    if (!value) throw new BusinessStoreError("NOT_FOUND");
    if (value.ownerId !== ownerId) throw new BusinessStoreError("FORBIDDEN");
    if (value.role !== "assistant" || value.generationStatus !== "pending") throw new BusinessStoreError("CONFLICT");
    value.content = content;
    value.generationStatus = status;
    return structuredClone(value);
  }

  async saveTopicAssessment(conversationId: string, ownerId: string, assistantMessageId: string, assessment: TopicAssessment) {
    await this.getConversation(conversationId, ownerId);
    const message = this.messages.get(assistantMessageId);
    if (!message || message.ownerId !== ownerId || message.conversationId !== conversationId || message.role !== "assistant") {
      throw new BusinessStoreError("FORBIDDEN");
    }
    this.assessments.set(assistantMessageId, structuredClone(assessment));
  }

  async getTopicAssessment(conversationId: string, ownerId: string, assistantMessageId: string) {
    await this.getConversation(conversationId, ownerId);
    const message = this.messages.get(assistantMessageId);
    if (!message || message.ownerId !== ownerId || message.conversationId !== conversationId) throw new BusinessStoreError("FORBIDDEN");
    return structuredClone(this.assessments.get(assistantMessageId) ?? null);
  }

  async listTopicDisplays(conversationId: string, ownerId: string) {
    await this.getConversation(conversationId, ownerId);
    return [...this.displays.values()].filter(x => x.conversationId === conversationId && x.ownerId === ownerId)
      .sort((a,b) => a.createdAt.localeCompare(b.createdAt)).map(x => structuredClone(x));
  }

  async markTopicDisplayed(conversationId: string, ownerId: string, assistantMessageId: string, topicKey: string) {
    await this.getConversation(conversationId, ownerId);
    const assessment = await this.getTopicAssessment(conversationId, ownerId, assistantMessageId);
    if (!assessment || assessment.topicKey !== topicKey) throw new BusinessStoreError("CONFLICT");
    const key = `${conversationId}:${assistantMessageId}`;
    const existing = this.displays.get(key);
    if (existing) return structuredClone(existing);
    const current = [...this.displays.values()].filter(x=>x.conversationId===conversationId);
    if (current.length >= 2 || current.some(x=>x.topicKey===topicKey)) throw new BusinessStoreError("CONFLICT");
    const value = { id: randomUUID(), conversationId, ownerId, assistantMessageId, topicKey, createdAt: new Date().toISOString() };
    this.displays.set(key, value);
    return structuredClone(value);
  }
}
