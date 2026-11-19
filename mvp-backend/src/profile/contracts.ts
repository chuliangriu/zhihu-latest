import { z } from "zod";
const citation = z.object({ refId: z.string().trim().min(1), quote: z.string().min(1) }).strict();
const claim = z.object({ text: z.string().trim().min(1), kind: z.enum(["self_report", "interest_observation"]), citations: z.array(citation).min(1) }).strict();
// Accept sparse model drafts for assembly; the final card contract below always has two background paragraphs and one focus.
export const profileModelSchema = z.object({
  insufficientEvidence: z.boolean().default(false), background: z.array(claim).default([]),
  recentFocus: claim.nullish().transform(value => value ?? null),
  unknown: z.array(z.string()).default([]).transform(values => values.map(v => v.trim()).filter(v => v && v !== "无"))
}).strict();
export const profileCardSchema = z.object({
  role: z.string(), impression: z.array(z.string().trim().min(1)).length(2),
  recentFocus: z.string().trim().min(1), markdown: z.string(), requiresConfirmation: z.literal(true)
}).strict();
export type ProfileModelOutput = z.infer<typeof profileModelSchema>;
export interface ProfileEvidenceIssue {
  path: string;
  code: "claim_text_invalid" | "citation_ref_unknown" | "self_report_requires_creation" | "self_report_requires_summary_quote" | "citation_quote_not_found";
}
export interface ProfileSources { creation: "read" | "failed" | "not_requested"; collection: "read" | "failed" | "not_requested"; }
export interface Footprint { id: string; kind: "creation" | "collection"; title: string; summary: string; occurredAt: string; }
export interface AccessSecretCheck { status: "accepted" | "rejected" | "unavailable"; httpStatus?: number; upstreamCode?: number; }
export interface FootprintSource {
  load(userId: string, signal: AbortSignal, onRequest: () => void): Promise<Footprint[]>;
  checkAccessSecret?(signal: AbortSignal): Promise<AccessSecretCheck>;
}
export interface ProfileConnectionDiagnostic {
  accessSecret?: AccessSecretCheck;
  stage: "account_lookup" | "token_decryption" | "creation" | "collection";
  httpStatus?: number;
  upstreamCode?: number;
  hint?: "application_mismatch" | "oauth_rejected" | "access_secret_rejected" | "permission_denied" | "unspecified";
}
export interface ProfileDiagnostics {
  schemaIssues?: import("../llm/provider.js").SchemaIssueDiagnostic[];
  schemaCorrectionAttempted?: boolean;
  evidenceIssues?: ProfileEvidenceIssue[];
  evidenceCorrectionAttempted?: boolean;
  generationMode?: "model" | "source_excerpt";
  fallbackReason?: string;
  usableCount: number;
  modelCalled: boolean;
  stage: "reading" | "filtering" | "model" | "evidence" | "complete";
}
export interface ProfileSummary {
  requestId: string;
  diagnostics: ProfileDiagnostics;
  connection?: ProfileConnectionDiagnostic;
  sources?: ProfileSources;
  retryAfterSeconds?: number;
  status: "ready" | "needs_input" | "unavailable";
  reasonCode: string;
  profile: { role: string; impression: string[]; recentFocus: string; markdown: string; requiresConfirmation: true } | null;
  coverage: { creations: number; collections: number; browsingAvailable: false; likedHistoryAvailable: false };
}
