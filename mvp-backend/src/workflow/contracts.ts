import { z } from "zod";

export const ownPaperModelSchema = z.object({
  subject: z.string().trim().min(1).max(24),
  quote: z.string().trim().min(8).max(100),
  context: z.string().trim().min(1).max(30),
  background: z.string().trim().min(8).max(160)
}).strict();

export const paperDraftRequestSchema = z.object({
  conversationId: z.string().uuid(),
  confirmedProfile: z.object({
    background: z.array(z.string().trim().min(1).max(160)).max(2),
    recentFocus: z.string().trim().min(1).max(180).nullable()
  }).strict().nullable().default(null)
}).strict();

export const paperEditRequestSchema = ownPaperModelSchema.extend({ expectedVersion: z.number().int().positive() }).strict();

export const paperConfirmRequestSchema = z.object({
  expectedVersion: z.number().int().positive(),
  discoverableDays: z.literal(7).default(7),
  identityDisclosure: z.enum(["anonymous", "nickname"]).default("nickname"),
  contactAllowed: z.boolean().default(true),
  matchingAllowed: z.boolean().default(true),
  target: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("mailbox_only") }).strict(),
    z.object({ kind: z.literal("selected_private"), discoveryId: z.string().uuid(), candidateId: z.string().min(1).max(80) }).strict(),
    z.object({ kind: z.literal("synthetic_demo"), discoveryId: z.string().uuid(), candidateId: z.string().min(1).max(80) }).strict()
  ]).default({ kind: "mailbox_only" })
}).strict();

export const handoffRequestSchema = z.object({
  discoveryId: z.string().uuid(),
  candidateId: z.string().min(1).max(80)
}).strict();

export interface StoredDiscoveryCandidate {
  candidateId: string;
  path: "situationClose" | "structureRelated";
  sourceType: "public" | "authorized_private" | "synthetic_private";
  sourceUrl: string | null;
  authorProfileUrl: string | null;
  contactable: boolean;
  publishedAt: string;
  excerptSnapshot: string;
  relationSnapshot: string;
}

export interface StoredDiscovery {
  id: string;
  ownerId: string;
  conversationId: string;
  pipelineRequestId: string;
  candidates: StoredDiscoveryCandidate[];
  createdAt: string;
  expiresAt: string;
}

export interface StoredPaper {
  id: string;
  ownerId: string;
  conversationId: string;
  expressionId?: string | null;
  matchingAllowed?: boolean;
  version: number;
  status: "draft" | "active" | "withdrawn" | "expired";
  subject: string;
  quote: string;
  context: string;
  background: string;
  discoverableUntil: string | null;
  identityDisclosure: "anonymous" | "nickname";
  contactAllowed: boolean;
  confirmedAt: string | null;
  withdrawnAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StoredDelivery {
  id: string;
  paperId: string;
  paperVersion: number;
  senderId: string;
  discoveryId: string;
  candidateId: string;
  status: "delivered" | "cancelled";
  createdAt: string;
}


export const openDiscussionRequestSchema = handoffRequestSchema;
export const replyRequestSchema = z.object({
  content: z.string().trim().min(1).max(2000),
  clientMessageId: z.string().uuid()
}).strict();
const paperPreviewSchema = z.object({
  id: z.string().uuid(), status: z.enum(["active", "expired", "withdrawn"]),
  subject: z.string(), quote: z.string().nullable(), background: z.string().nullable(),
  displayName: z.string(), own: z.boolean()
}).strict();
export const discussionViewSchema = z.object({
  id: z.string().uuid(), paper: paperPreviewSchema, introduction: paperPreviewSchema,
  canReply: z.boolean(), closedReason: z.enum(["paper_withdrawn", "contact_disabled"]).nullable(),
  createdAt: z.string(), updatedAt: z.string(),
  messages: z.array(z.object({id:z.string().uuid(),own:z.boolean(),content:z.string(),createdAt:z.string()}).strict())
}).strict();
export type DiscussionView = z.infer<typeof discussionViewSchema>;
export const matchedPaperViewSchema = z.object({
  status: z.enum(["active", "expired", "withdrawn"]), paper: paperPreviewSchema.nullable(),
  contactable: z.boolean(), discussionId: z.string().uuid().nullable()
}).strict();
export type MatchedPaperView = z.infer<typeof matchedPaperViewSchema>;
