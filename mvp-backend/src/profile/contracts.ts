import { z } from "zod";
const citation = z.object({ refId: z.string().min(1).max(80), quote: z.string().min(2).max(300) }).strict();
const claim = z.object({ text: z.string().trim().min(1).max(80), kind: z.enum(["self_report", "interest_observation"]), citations: z.array(citation).min(1).max(6) }).strict();
const recentFocus = claim.extend({ text: z.string().trim().min(1).max(90) });
const unknown = z.array(z.enum(["年龄", "职业", "学校", "城市", "关系状态", "健康情况"])).max(6);
// Ready and insufficient-evidence responses have different, explicit structures.
export const profileModelSchema = z.discriminatedUnion("insufficientEvidence", [
  z.object({ insufficientEvidence: z.literal(false), background: z.array(claim).length(2), recentFocus, unknown }).strict(),
  z.object({ insufficientEvidence: z.literal(true), background: z.array(claim).length(0), recentFocus: z.null(), unknown }).strict()
]);
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
