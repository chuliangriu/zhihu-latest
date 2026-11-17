import { z } from "zod";

export const PIPELINE_VERSION = "discovery-v0.4";
export const PROMPT_VERSION = "discovery-prompts-v0.7";

export const conversationMessageSchema = z
  .object({
    id: z.string().min(1).max(80),
    role: z.enum(["user", "assistant"]),
    content: z.string().trim().min(1).max(4_000),
    generationStatus: z.enum(["complete", "pending", "failed"]).optional()
  })
  .strict();

export const conversationContextSchema = z
  .object({
    messages: z.array(conversationMessageSchema).min(1).max(24)
  })
  .strict();

export const evaluateRequestSchema = z
  .object({
    fixtureSet: z
      .string()
      .regex(/^[a-z0-9][a-z0-9-]{0,63}$/)
      .default("feedback-across-domains"),
    conversation: conversationContextSchema.optional()
  })
  .strict();

export const candidateExpressionSchema = z
  .object({
    candidateId: z.string().min(1).max(80),
    authorId: z.string().min(1).max(80),
    authorDisplayName: z.string().min(1).max(80),
    authorProfileUrl: z.string().url().nullable().optional(),
    profileBackground: z.array(z.string().trim().min(1).max(80)).max(2).optional(),
    recentFocus: z.string().trim().min(1).max(90).nullable().optional(),
    domain: z.string().min(1).max(40),
    text: z.string().trim().min(8).max(4_000),
    source: z
      .object({
        sourceId: z.string().min(1).max(100),
        sourceType: z.enum(["public", "authorized_private", "synthetic_private"]),
        contentType: z.enum(["question", "answer", "article", "comment", "authorized_expression"]),
        url: z.string().url().nullable(),
        publishedAt: z.string().datetime(),
        timestampKind: z.enum(["published", "edited_or_published", "sample_created"]).optional(),
        interactionFacts: z.object({ upvotes: z.number().int().nonnegative().nullable(), comments: z.number().int().nonnegative().nullable() }).strict().optional(),
        verified: z.boolean()
      })
      .strict(),
    permission: z
      .object({
        discoverable: z.boolean(),
        identityDisclosable: z.boolean(),
        contactable: z.boolean(),
        status: z.enum(["active", "withdrawn", "locked"])
      })
      .strict()
  })
  .strict();

export const discoveryIntentOutputSchema = z
  .object({
    shouldSearch: z.boolean(),
    reasonCodes: z.array(z.string().min(1).max(60)).max(8),
    primaryDomain: z.string().min(1).max(40).nullable(),
    explicitConcerns: z.array(z.string().min(1).max(160)).max(8),
    uncertainPoints: z.array(z.string().min(1).max(160)).max(8),
    searchDirections: z.array(z.string().min(1).max(120)).max(5),
    refusalReason: z.string().max(240).nullable()
  })
  .strict();

export const evidenceCitationSchema = z
  .object({
    side: z.enum(["user", "candidate"]),
    refId: z.string().min(1).max(100),
    quote: z.string().trim().min(2).max(280)
  })
  .strict();

export const matchDraftSchema = z
  .object({
    path: z.enum(["situationClose", "structureRelated"]),
    candidateId: z.string().min(1).max(80),
    sharedRelation: z.string().trim().min(8).max(360),
    difference: z.string().trim().min(8).max(360),
    evidence: z.array(evidenceCitationSchema).min(2).max(8)
  })
  .strict();

export const presentationChoiceCopySchema = z
  .object({
    path: z.enum(["situationClose", "structureRelated"]),
    candidateId: z.string().min(1).max(80),
    bridge: z.string().trim().min(8).max(80),
    relation: z.string().trim().min(8).max(90)
  })
  .strict();

export const presentationCopyOutputSchema = z
  .object({
    sharedConcern: z.string().trim().min(8).max(45),
    choices: z.array(presentationChoiceCopySchema).min(1).max(2)
  })
  .strict();

export const candidateAnalysisOutputSchema = z
  .object({
    matches: z.array(matchDraftSchema).max(2),
    inviteCopy: z.string().trim().min(1).max(240).nullable(),
    rejectionReasons: z.array(z.string().min(1).max(200)).max(8),
    presentationCopy: presentationCopyOutputSchema.nullable().optional()
  })
  .strict();

export const discoveryStatusSchema = z.enum([
  "matched",
  "no_match",
  "not_eligible",
  "unavailable"
]);

export const matchResultSchema = matchDraftSchema
  .omit({ evidence: true })
  .extend({
    authorDisplayName: z.string().min(1).max(80),
    profileBackground: z.array(z.string().trim().min(1).max(80)).max(2),
    recentFocus: z.string().trim().min(1).max(90).nullable(),
    sourceType: z.enum(["public", "authorized_private", "synthetic_private"]),
    contentType: z.enum(["question", "answer", "article", "comment", "authorized_expression"]),
    sourceUrl: z.string().url().nullable(),
    authorProfileUrl: z.string().url().nullable(),
    publishedAt: z.string().datetime(),
    timestampKind: z.enum(["published", "edited_or_published", "sample_created"]).optional(),
    interactionFacts: z.object({ upvotes: z.number().int().nonnegative().nullable(), comments: z.number().int().nonnegative().nullable() }).strict().optional(),
    contactable: z.boolean(),
    identityDisclosable: z.boolean(),
    evidenceRefs: z.array(evidenceCitationSchema).min(2).max(8)
  })
  .strict();

export const discoveryResultSchema = z
  .object({
    requestId: z.string().uuid(),
    status: discoveryStatusSchema,
    shouldInvite: z.boolean(),
    understanding: z
      .object({
        explicitConcerns: z.array(z.string()),
        uncertainPoints: z.array(z.string())
      })
      .strict(),
    matches: z
      .object({
        situationClose: matchResultSchema.nullable(),
        structureRelated: matchResultSchema.nullable()
      })
      .strict(),
    inviteCopy: z.string().nullable(),
    presentationCopy: presentationCopyOutputSchema.nullable(),
    reasonCode: z.string().min(1).max(80),
    dataMode: z.enum(["fixture", "routed"]),
    modelMode: z.enum(["mock", "live"]),
    meta: z
      .object({
        pipelineVersion: z.string(),
        promptVersion: z.string(),
        matchPolicyVersion: z.string(),
        eligiblePrivatePoolSize: z.number().int().nonnegative().nullable(),
        matchPolicyTier: z.enum(["scarce", "growing", "mature"]).nullable(),
        durationMs: z.number().nonnegative(),
        candidateCount: z.number().int().nonnegative()
      })
      .strict()
  })
  .strict();

export const fixtureCandidateSchema = candidateExpressionSchema
  .omit({ source: true })
  .extend({
    source: candidateExpressionSchema.shape.source.omit({ publishedAt: true }).extend({
      ageDays: z.number().int().min(0).max(365)
    })
  });

export const fixtureSchema = z
  .object({
    id: z.string(),
    description: z.string(),
    trustedContext: z
      .object({
        allowDiscovery: z.boolean(),
        safetyPassed: z.boolean()
      })
      .strict(),
    request: evaluateRequestSchema.omit({ fixtureSet: true }),
    candidates: z.array(fixtureCandidateSchema).max(12),
    mockOutputs: z
      .object({
        intent: discoveryIntentOutputSchema,
        candidateAnalysis: candidateAnalysisOutputSchema.optional(),
        presentationCopy: presentationCopyOutputSchema.optional()
      })
      .strict(),
    expected: z
      .object({
        status: discoveryStatusSchema,
        structureRelatedCandidateId: z.string().nullable().optional()
      })
      .strict()
  })
  .strict();

export type EvaluateRequest = z.infer<typeof evaluateRequestSchema>;
export type ConversationContext = z.infer<typeof conversationContextSchema>;
export type CandidateExpression = z.infer<typeof candidateExpressionSchema>;
export type DiscoveryIntentOutput = z.infer<typeof discoveryIntentOutputSchema>;
export type CandidateAnalysisOutput = z.infer<typeof candidateAnalysisOutputSchema>;
export type PresentationCopyOutput = z.infer<typeof presentationCopyOutputSchema>;
export type MatchDraft = z.infer<typeof matchDraftSchema>;
export type MatchResult = z.infer<typeof matchResultSchema>;
export type DiscoveryResult = z.infer<typeof discoveryResultSchema>;
export type Fixture = z.infer<typeof fixtureSchema>;
