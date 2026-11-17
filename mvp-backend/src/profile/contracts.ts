import { z } from "zod";
const citation = z.object({ refId: z.string().min(1).max(80), quote: z.string().min(2).max(300) }).strict();
const claim = z.object({ text: z.string().trim().min(1).max(80), kind: z.enum(["self_report", "interest_observation"]), citations: z.array(citation).min(1).max(6) }).strict();
export const profileModelSchema = z.object({
  insufficientEvidence: z.boolean(), background: z.array(claim).max(2),
  recentFocus: claim.extend({ text: z.string().trim().min(1).max(90) }).nullable(),
  unknown: z.array(z.enum(["年龄", "职业", "学校", "城市", "关系状态", "健康情况"])).max(6)
}).strict();
export interface Footprint { id: string; kind: "creation" | "collection"; title: string; summary: string; occurredAt: string; }
export interface FootprintSource { load(userId: string, signal: AbortSignal, onRequest: () => void): Promise<Footprint[]>; }
export interface ProfileConnectionDiagnostic {
  stage: "account_lookup" | "token_decryption" | "creation" | "collection";
  httpStatus?: number;
  upstreamCode?: number;
  hint?: "application_mismatch" | "oauth_rejected" | "access_secret_rejected" | "permission_denied" | "unspecified";
}
export interface ProfileSummary {
  connection?: ProfileConnectionDiagnostic;
  status: "ready" | "needs_input" | "unavailable";
  reasonCode: string;
  profile: { role: string; impression: string[]; recentFocus: string; markdown: string; requiresConfirmation: true } | null;
  coverage: { creations: number; collections: number; browsingAvailable: false; likedHistoryAvailable: false };
}
