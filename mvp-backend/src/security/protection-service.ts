import { randomUUID } from "node:crypto";
import type { AppConfig } from "../config.js";
import type { PipelineTrace } from "../pipeline/discovery-pipeline.js";
import type { MonitoringStore } from "./monitoring-store.js";
import type { ProtectionStore } from "./protection-store.js";
import type {
  ActualUsage,
  AuthenticatedPrincipal,
  EndpointId,
  Reservation,
  UsageEvent
} from "./types.js";

export interface RequestSecurityContext {
  requestId: string;
  endpointId: EndpointId;
  principal: AuthenticatedPrincipal;
  userIdHash: string;
  sessionIdHash: string;
  ipHash: string;
  reservation: Reservation;
  startedAt: number;
}

export type BeginDecision =
  | { allowed: true; context: RequestSecurityContext; rateRemaining: number; rateResetAt: number }
  | {
      allowed: false;
      statusCode: 409 | 429 | 503;
      reasonCode: string;
      rateRemaining?: number;
      rateResetAt?: number;
    };

export class ProtectionService {
  constructor(
    private readonly config: AppConfig,
    private readonly protectionStore: ProtectionStore,
    private readonly monitoringStore: MonitoringStore
  ) {}

  async beginDiscovery(input: {
    principal: AuthenticatedPrincipal;
    userIdHash: string;
    sessionIdHash: string;
    ipHash: string;
    idempotencyKey: string;
    endpointId?: EndpointId;
    llmRequestBase?: number;
    userDataRequestReserve?: number;
    zhihuSearchRequestReserve?: number;
    requiresLlm?: boolean;
  }): Promise<BeginDecision> {
    try {
      const endpointId = input.endpointId ?? "discovery.evaluate";
      const requiresLlm = input.requiresLlm ?? true;
      await this.monitoringStore.ping();
      const rate = await this.protectionStore.consumeRateLimits([
        {
          key: `ip:${input.ipHash}:${endpointId}`,
          limit: this.config.quota.rateIpMax,
          windowMs: this.config.quota.rateIpWindowMs
        },
        {
          key: `user:${input.userIdHash}:${endpointId}`,
          limit: this.config.quota.rateUserMax,
          windowMs: this.config.quota.rateUserWindowMs
        }
      ]);
      if (!rate.allowed) {
        return {
          allowed: false,
          statusCode: 429,
          reasonCode: rate.reasonCode ?? "SHORT_RATE_LIMITED",
          rateRemaining: rate.remaining,
          rateResetAt: rate.resetAt
        };
      }

      const claimed = await this.protectionStore.claimIdempotency(
        `${input.userIdHash}:${endpointId}:${input.idempotencyKey}`,
        this.config.quota.idempotencyTtlMs
      );
      if (!claimed) {
        return { allowed: false, statusCode: 409, reasonCode: "IDEMPOTENCY_REPLAY" };
      }

      const date = new Date().toISOString().slice(0, 10);
      const llmRequestReserve = requiresLlm ? (input.llmRequestBase ?? (endpointId === "profile.summarize" ? 1 : endpointId === "discovery.evaluate" && this.config.candidateMode === "routed" ? 5 : 3)) + this.config.llm.maxRetries : 0;
      const outputTokenReserve = this.config.llm.maxOutputTokens * llmRequestReserve;
      const requestId = randomUUID();
      const reservationDecision = await this.protectionStore.reserve({
        reservationId: requestId,
        leaseMs: this.config.quota.reservationLeaseMs,
        budgetItems: [
          ...((input.userDataRequestReserve ?? (endpointId === "profile.summarize" ? 2 : 0)) > 0 ? [
            budget(`${date}:user:${input.userIdHash}:zhihu_user_data_request`, input.userDataRequestReserve ?? 2, this.config.quota.dailyUserZhihuDataRequests),
            budget(`${date}:global:all:zhihu_user_data_request`, input.userDataRequestReserve ?? 2, this.config.quota.dailyGlobalZhihuDataRequests)
          ] : []),
          ...((input.zhihuSearchRequestReserve ?? 0)>0?[
            budget(`${date}:user:${input.userIdHash}:zhihu_search_request`,input.zhihuSearchRequestReserve!,this.config.quota.dailyUserZhihuSearchRequests),
            budget(`${date}:global:all:zhihu_search_request`,input.zhihuSearchRequestReserve!,this.config.quota.dailyGlobalZhihuSearchRequests)
          ]:[]),
          budget(`${date}:user:${input.userIdHash}:discovery_workflow`, 1, this.config.quota.dailyUserWorkflows),
          budget(`${date}:ip:${input.ipHash}:discovery_workflow`, 1, this.config.quota.dailyIpWorkflows),
          ...(requiresLlm ? [budget(`${date}:user:${input.userIdHash}:llm_request`, llmRequestReserve, this.config.quota.dailyUserLlmRequests),
          budget(`${date}:global:all:llm_request`, llmRequestReserve, this.config.quota.dailyGlobalLlmRequests),
          budget(
            `${date}:user:${input.userIdHash}:llm_input_token`,
            this.config.llm.inputTokenReserve,
            this.config.quota.dailyUserInputTokens
          ),
          budget(
            `${date}:global:all:llm_input_token`,
            this.config.llm.inputTokenReserve,
            this.config.quota.dailyGlobalInputTokens
          ),
          budget(
            `${date}:user:${input.userIdHash}:llm_output_token`,
            outputTokenReserve,
            this.config.quota.dailyUserOutputTokens
          ),
          budget(
            `${date}:global:all:llm_output_token`,
            outputTokenReserve,
            this.config.quota.dailyGlobalOutputTokens
          )] : [])
        ],
        concurrency: requiresLlm ? [
          { key: `user:${input.userIdHash}:high-cost`, limit: this.config.quota.userConcurrencyMax },
          { key: "global:high-cost", limit: this.config.quota.globalConcurrencyMax }
        ] : [],
        requiresLlm
      });
      if (!reservationDecision.allowed) {
        const statusCode =
          reservationDecision.reasonCode === "DAILY_QUOTA_EXCEEDED" ||
          reservationDecision.reasonCode === "CONCURRENCY_LIMITED"
            ? 429
            : 503;
        return {
          allowed: false,
          statusCode,
          reasonCode: reservationDecision.reasonCode
        };
      }

      return {
        allowed: true,
        rateRemaining: rate.remaining,
        rateResetAt: rate.resetAt,
        context: {
          requestId,
          endpointId,
          principal: input.principal,
          userIdHash: input.userIdHash,
          sessionIdHash: input.sessionIdHash,
          ipHash: input.ipHash,
          reservation: reservationDecision.reservation,
          startedAt: Date.now()
        }
      };
    } catch {
      return { allowed: false, statusCode: 503, reasonCode: "BUDGET_SERVICE_UNAVAILABLE" };
    }
  }

  async finishDiscovery(
    context: RequestSecurityContext,
    input: {
      statusCode: number;
      businessStatus: string;
      reasonCode: string;
      trace?: PipelineTrace;
      conservative: boolean;
      userDataRequests?: number;
      profile?: UsageEvent["profile"];
    }
  ): Promise<void> {
    const actual = usageFromTrace(input.trace);
    actual.zhihuUserDataRequests = input.userDataRequests ?? 0;
    const hasUnknownLiveUsage =
      this.config.llm.mode === "live" &&
      Boolean(input.trace?.stages.some((stage) => stage.usage && (stage.usage.inputTokens === null || stage.usage.outputTokens === null)));
    await this.protectionStore.settle(context.reservation, actual, input.conservative || hasUnknownLiveUsage);
    const retries = input.trace?.stages.reduce((sum, stage) => sum + (stage.usage?.retries ?? 0), 0) ?? 0;
    const event: UsageEvent = {
      requestId: input.trace?.requestId ?? context.requestId,
      timestamp: new Date().toISOString(),
      endpointId: context.endpointId,
      userIdHash: context.userIdHash,
      ipHash: context.ipHash,
      sessionIdHash: context.sessionIdHash,
      statusCode: input.statusCode,
      businessStatus: input.businessStatus,
      durationMs: Math.max(0, Date.now() - context.startedAt),
      llm: {
        provider: this.config.llm.mode === "live" ? new URL(this.config.llm.baseUrl).hostname : "mock",
        model: this.config.llm.mode === "live" ? this.config.llm.model ?? "configured" : "mock",
        requests: actual.llmRequests,
        retries,
        inputTokens: actual.llmInputTokens,
        outputTokens: actual.llmOutputTokens,
        estimatedCostUsd: estimateCost(actual, this.config)
      },
      zhihu: { searchRequests: actual.zhihuSearchRequests, userDataRequests: actual.zhihuUserDataRequests },
      quotaDecision: "allowed",
      reasonCode: input.reasonCode,
      ...(input.profile ? { profile: { ...input.profile } } : {})
    };
    await this.monitoringStore.record(event);
    console.info(JSON.stringify({ type: "usage_event", ...event }));
    await this.emitAlerts(event);
  }

  private async emitAlerts(event: UsageEvent): Promise<void> {
    if (event.llm.retries > 0 || event.statusCode >= 500 || /HTTP_401|HTTP_403|AUTH/i.test(event.reasonCode)) {
      console.warn(
        JSON.stringify({
          type: "security_alert",
          alert: "upstream_or_workflow_failure",
          requestId: event.requestId,
          reasonCode: event.reasonCode,
          statusCode: event.statusCode
        })
      );
    }

    const date = event.timestamp.slice(0, 10);
    const summary = await this.monitoringStore.summary(date);
    const metrics = [
      { name: "llm_requests", used: summary.llmRequests, limit: this.config.quota.dailyGlobalLlmRequests },
      { name: "llm_input_tokens", used: summary.llmInputTokens, limit: this.config.quota.dailyGlobalInputTokens },
      { name: "llm_output_tokens", used: summary.llmOutputTokens, limit: this.config.quota.dailyGlobalOutputTokens }
    ];
    for (const metric of metrics) {
      const ratio = metric.limit > 0 ? metric.used / metric.limit : 0;
      for (const threshold of [0.5, 0.8, 1]) {
        if (ratio < threshold) continue;
        const first = await this.protectionStore.claimIdempotency(
          `alert:${date}:${metric.name}:${threshold}`,
          172_800_000
        );
        if (!first) continue;
        console.warn(
          JSON.stringify({
            type: "security_alert",
            alert: "daily_budget_threshold",
            metric: metric.name,
            threshold,
            used: metric.used,
            limit: metric.limit,
            date
          })
        );
        if (threshold === 1) await this.protectionStore.setLlmEnabled(false);
      }
    }
  }
}

function usageFromTrace(trace: PipelineTrace | undefined): ActualUsage {
  if (!trace) {
    return {
      discoveryWorkflows: 1,
      llmRequests: 0,
      llmInputTokens: 0,
      llmOutputTokens: 0,
      zhihuSearchRequests: 0
    };
  }
  return {
    discoveryWorkflows: 1,
    llmRequests: trace.stages.reduce((sum, stage) => sum + (stage.usage?.requests ?? 0), 0),
    llmInputTokens: trace.stages.reduce((sum, stage) => sum + (stage.usage?.inputTokens ?? 0), 0),
    llmOutputTokens: trace.stages.reduce((sum, stage) => sum + (stage.usage?.outputTokens ?? 0), 0),
    zhihuSearchRequests: trace.stages.reduce((sum,stage)=>sum+(stage.zhihuSearchRequests??0),0)
  };
}

function estimateCost(actual: ActualUsage, config: AppConfig): number {
  return Number(
    (
      (actual.llmInputTokens / 1_000_000) * config.llm.inputCostPerMillionUsd +
      (actual.llmOutputTokens / 1_000_000) * config.llm.outputCostPerMillionUsd
    ).toFixed(6)
  );
}

function budget(key: string, amount: number, limit: number) {
  return { key, amount, limit };
}
