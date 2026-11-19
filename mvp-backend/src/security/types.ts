export type EndpointId =
  | "health.read"
  | "chat.reply"
  | "chat.discovery-display"
  | "discovery.evaluate"
  | "profile.summarize"
  | "mailbox.read"
  | "discussion.open"
  | "discussion.reply"
  | "paper.draft"
  | "paper.edit"
  | "paper.confirm"
  | "paper.withdraw"
  | "handoff.create"
  | "internal.usage"
  | "internal.controls.llm-mode";

export type UserRole = "user" | "reviewer" | "admin";

export interface AuthenticatedPrincipal {
  userId: string;
  sessionId: string;
  role: UserRole;
  status: "active";
}

export interface RateLimitRule {
  key: string;
  limit: number;
  windowMs: number;
}

export interface RateLimitDecision {
  allowed: boolean;
  remaining: number;
  resetAt: number;
  reasonCode?: string;
}

export interface BudgetItem {
  key: string;
  amount: number;
  limit: number;
}

export interface ReservationRequest {
  reservationId: string;
  budgetItems: BudgetItem[];
  concurrency: Array<{ key: string; limit: number }>;
  leaseMs: number;
  nowMs?: number;
  requiresLlm?: boolean;
}

export interface Reservation {
  reservationId: string;
  budgetItems: BudgetItem[];
  concurrencyKeys: string[];
  expiresAt: number;
}

export type ReservationDecision =
  | { allowed: true; reservation: Reservation }
  | {
      allowed: false;
      reasonCode: "DAILY_QUOTA_EXCEEDED" | "GLOBAL_BUDGET_EXCEEDED" | "CONCURRENCY_LIMITED" | "LLM_DISABLED";
    };

export interface ActualUsage {
  discoveryWorkflows: number;
  llmRequests: number;
  llmInputTokens: number;
  llmOutputTokens: number;
  zhihuSearchRequests: number;
  zhihuUserDataRequests?: number;
}

export interface UsageEvent {
  requestId: string;
  timestamp: string;
  endpointId: EndpointId;
  userIdHash: string | null;
  ipHash: string;
  sessionIdHash: string | null;
  statusCode: number;
  businessStatus: string;
  durationMs: number;
  llm: {
    provider: string;
    model: string;
    requests: number;
    retries: number;
    inputTokens: number;
    outputTokens: number;
    estimatedCostUsd: number;
  };
  zhihu: {
    searchRequests: number;
    userDataRequests: number;
  };
  profile?: import("../profile/contracts.js").ProfileDiagnostics;
  quotaDecision: "allowed" | "rejected" | "not_applicable";
  reasonCode: string;
}

export interface UsageQuery {
  date: string;
  endpointId?: EndpointId;
  statusCode?: number;
  limit: number;
  cursor: number;
}

export interface UsageSummary {
  date: string;
  requestCount: number;
  workflowCount: number;
  successCount: number;
  errorCount: number;
  statusCounts: Record<string, number>;
  llmRequests: number;
  llmRetries: number;
  llmInputTokens: number;
  llmOutputTokens: number;
  estimatedCostUsd: number;
  zhihuSearchRequests: number;
  topUsers: Array<{ idHash: string; requests: number; llmRequests: number }>;
  topIps: Array<{ idHash: string; requests: number; llmRequests: number }>;
}
