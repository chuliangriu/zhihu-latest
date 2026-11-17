import { z } from "zod";

export const chatRequestSchema = z.object({
  conversationId: z.string().uuid().nullable().default(null),
  message: z.string().trim().min(1).max(4_000)
}).strict();

export const topicAssessmentSchema = z.object({
  personalSituation: z.boolean(),
  topicKey: z.string().trim().min(1).max(120).nullable(),
  evidenceMessageIds: z.array(z.string().uuid()).max(12),
  transition: z.enum(["first", "same_topic", "clear_change", "uncertain"]),
  reason: z.string().trim().min(1).max(160)
}).strict();

export type TopicAssessment = z.infer<typeof topicAssessmentSchema>;

export interface StoredConversation {
  id: string;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
}

export interface StoredMessage {
  id: string;
  conversationId: string;
  ownerId: string;
  role: "user" | "assistant";
  content: string;
  generationStatus: "complete" | "pending" | "failed";
  createdAt: string;
}

export interface StoredTopicDisplay {
  id: string;
  conversationId: string;
  ownerId: string;
  assistantMessageId: string;
  topicKey: string;
  createdAt: string;
}

export interface ChatCompletionResult {
  conversationId: string;
  userMessageId: string;
  assistantMessageId: string;
  discovery: {
    eligible: boolean;
    reasonCode: string;
    topicKey: string | null;
    evidenceMessageIds: string[];
    displayOrdinal: 1 | 2 | null;
    policyVersion: string;
  };
}
