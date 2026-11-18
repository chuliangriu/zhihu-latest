import { randomUUID } from "node:crypto";
import express, { type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import type { AppConfig } from "../config.js";
import { evaluateRequestSchema } from "../contracts/schemas.js";
import type { PipelineTrace } from "../pipeline/discovery-pipeline.js";
import type { DiscoveryRuntime } from "../runtime.js";
import { FixtureError } from "../sources/fixture-repository.js";
import { hashIdentifier, requireAdmin, requireInternalIdentity } from "../security/identity.js";
import { requireSessionIdentity, type SessionResolver } from "../security/session-identity.js";
import {
  InMemoryMonitoringStore,
  MonitoringStoreUnavailableError,
  isEndpointId,
  type MonitoringStore
} from "../security/monitoring-store.js";
import { scanConversationForPromptInjection } from "../security/prompt-injection.js";
import {
  InMemoryProtectionStore,
  ProtectionStoreUnavailableError,
  type ProtectionStore
} from "../security/protection-store.js";
import { ProtectionService } from "../security/protection-service.js";
import type { EndpointId, UsageEvent } from "../security/types.js";
import type { ProfileSummaryService } from "../profile/summary-service.js";
import type { ChatService } from "../chat/service.js";
import type { WorkflowService } from "../workflow/service.js";
import type { WorkflowStore } from "../workflow/store.js";
import { registerWorkflowRoutes, workflowErrorMiddleware } from "./workflow-routes.js";

interface RuntimeResult {
  result: Awaited<ReturnType<DiscoveryRuntime["evaluate"]>>;
  trace: PipelineTrace;
}

export interface AppDependencies {
  config: AppConfig;
  runtime: Pick<DiscoveryRuntime, "evaluateDetailed">;
  protectionStore?: ProtectionStore;
  monitoringStore?: MonitoringStore;
  sessionResolver?: SessionResolver;
  profileService?: Pick<ProfileSummaryService, "generate">;
  profileInspector?: Pick<ProfileSummaryService, "inspect">;
  chatService?: ChatService;
  workflowService?: WorkflowService;
  workflowStore?: WorkflowStore;
}

const idempotencyKeyPattern = /^[A-Za-z0-9][A-Za-z0-9_.:-]{15,127}$/;
const usageDatePattern = /^\d{4}-\d{2}-\d{2}$/;

export function createApp(dependencies: AppDependencies) {
  const app = express();
  const protectionStore = dependencies.protectionStore ?? new InMemoryProtectionStore();
  const monitoringStore = dependencies.monitoringStore ?? new InMemoryMonitoringStore();
  const protection = new ProtectionService(dependencies.config, protectionStore, monitoringStore);

  app.disable("x-powered-by");
  if (dependencies.config.trustProxyHops > 0) app.set("trust proxy", dependencies.config.trustProxyHops);
  app.use(securityHeaders(dependencies.config));
  app.use(corsMiddleware(dependencies.config.corsOrigins));
  app.use(contentLengthGuard(dependencies.config.requestContentLengthMax));
  app.use(express.json({ limit: dependencies.config.requestBodyLimit, strict: true, type: "application/json" }));
  app.use(clientIdentityHash(dependencies.config));
  app.use(basicMonitoring(monitoringStore, dependencies.config));

  app.get("/health", (_request, response) => {
    response.json({
      status: "ok",
      service: "unseen-people-discovery",
      publicReady: dependencies.config.publicDeployment && dependencies.config.publicSecurityUnlock
    });
  });

  for (const route of [
    { method: "post", path: "/api/profile/summary", inspectOnly: false },
    { method: "get", path: "/api/profile/footprints", inspectOnly: true }
  ] as const) app[route.method](route.path,
    dependencies.config.authMode === "session"
      ? requireSessionIdentity(dependencies.sessionResolver, dependencies.config.corsOrigins)
      : requireInternalIdentity(dependencies.config),
    async (request, response, next) => {
      try {
        response.setHeader("Cache-Control", "no-store");
        if (route.inspectOnly && request.header("sec-fetch-site") === "cross-site") {
          response.status(403).json({ error: { code: "ORIGIN_FORBIDDEN" } }); return;
        }
        const valid = route.inspectOnly
          ? z.object({ requestId: z.string().regex(idempotencyKeyPattern) }).strict().safeParse(request.query).success
          : z.object({ useAuthorizedFootprints: z.literal(true) }).strict().safeParse(request.body).success;
        if (!valid) { response.status(400).json({ error: { code: "PROFILE_REQUEST_INVALID" } }); return; }
        const profileHandler = route.inspectOnly
          ? dependencies.profileInspector?.inspect.bind(dependencies.profileInspector)
          : dependencies.profileService?.generate.bind(dependencies.profileService);
        if (!profileHandler) { response.status(503).json({ error: { code: "PROFILE_NOT_CONNECTED" } }); return; }
        const key = route.inspectOnly ? String(request.query.requestId) : request.header("idempotency-key") ?? "";
        if (!idempotencyKeyPattern.test(key)) { response.status(400).json({ error: { code: "IDEMPOTENCY_KEY_REQUIRED" } }); return; }
        const principal = request.principal, secret = dependencies.config.identity.ipHashSecret, ipHash = request.clientIpHash;
        if (!principal || !secret || !ipHash) { response.status(503).json({ error: { code: "IDENTITY_SERVICE_UNAVAILABLE" } }); return; }
        const begin = await protection.beginDiscovery({ principal, ipHash, userIdHash: hashIdentifier(principal.userId, secret),
          sessionIdHash: hashIdentifier(principal.sessionId, secret), idempotencyKey: key, endpointId: "profile.summarize",
          requiresLlm: !route.inspectOnly, zhihuSearchRequestReserve: route.inspectOnly ? 1 : 0 });
        if (!begin.allowed) {
          if (begin.rateResetAt) response.setHeader("Retry-After", Math.max(1, Math.ceil((begin.rateResetAt-Date.now())/1000)));
          response.status(begin.statusCode).json({ error: publicQuotaError(begin.reasonCode) }); return;
        }
        response.setHeader("RateLimit-Remaining", begin.rateRemaining.toString());
        let detail: Awaited<ReturnType<ProfileSummaryService["generate"]>>;
        try { detail = await profileHandler(principal.userId); }
        catch (error) {
          await protection.finishDiscovery(begin.context, { statusCode: 503, businessStatus: "unavailable", reasonCode: "PROFILE_UNAVAILABLE", conservative: true });
          response.locals.monitoringRecorded = true; throw error;
        }
        if (detail.result.retryAfterSeconds) response.setHeader("Retry-After", detail.result.retryAfterSeconds);
        await protection.finishDiscovery(begin.context, { statusCode: detail.result.status === "unavailable" ? 503 : 200,
          businessStatus: detail.result.status, reasonCode: detail.result.reasonCode, trace: detail.trace,
          conservative: detail.trace.stages.some(stage => stage.name === "profile_summary" && !stage.usage), userDataRequests: detail.userDataRequests });
        response.locals.monitoringRecorded = true;
        response.status(detail.result.status === "unavailable" ? 503 : 200).json({ success: detail.result.status !== "unavailable", data: detail.result });
      } catch (error) { next(error); }
    });

  app.post(
    "/api/discovery/evaluate",
    dependencies.config.authMode === "session"
      ? requireSessionIdentity(dependencies.sessionResolver, dependencies.config.corsOrigins)
      : requireInternalIdentity(dependencies.config),
    async (request, response, next) => {
      try {
        const parsed = evaluateRequestSchema.safeParse(request.body);
        if (!parsed.success) {
          setBusinessResult(response, "invalid_request", "INVALID_REQUEST");
          response.status(400).json({ error: { code: "INVALID_REQUEST", message: "请求格式不符合约定" } });
          return;
        }

        if (dependencies.config.candidateMode === "routed" && (!parsed.data.conversation || Object.hasOwn(request.body, "fixtureSet"))) {
          response.status(400).json({ error: { code: "CONVERSATION_REQUIRED", message: "真实分流需要对话，不能指定测试集合" } }); return;
        }

        if (parsed.data.conversation && scanConversationForPromptInjection(parsed.data.conversation).length > 0) {
          setBusinessResult(response, "security_rejected", "PROMPT_INJECTION_BLOCKED");
          response.status(400).json({ error: { code: "PROMPT_INJECTION_BLOCKED", message: "输入包含不支持的控制指令" } });
          return;
        }

        const idempotencyKey = request.header("idempotency-key") ?? "";
        if (!idempotencyKeyPattern.test(idempotencyKey)) {
          setBusinessResult(response, "invalid_request", "IDEMPOTENCY_KEY_REQUIRED");
          response.status(400).json({
            error: { code: "IDEMPOTENCY_KEY_REQUIRED", message: "高成本请求需要有效的 Idempotency-Key" }
          });
          return;
        }

        const principal = request.principal;
        const ipHash = request.clientIpHash;
        const hashSecret = dependencies.config.identity.ipHashSecret;
        if (!principal || !ipHash || !hashSecret) {
          setBusinessResult(response, "unavailable", "IDENTITY_SERVICE_UNAVAILABLE");
          response.status(503).json({ error: { code: "IDENTITY_SERVICE_UNAVAILABLE", message: "身份服务尚未配置" } });
          return;
        }
        const userIdHash = hashIdentifier(principal.userId, hashSecret);
        const sessionIdHash = hashIdentifier(principal.sessionId, hashSecret);
        const begin = await protection.beginDiscovery({ principal, userIdHash, sessionIdHash, ipHash, idempotencyKey,
          ...(dependencies.config.publicSearchEnabled ? { zhihuSearchRequestReserve: 1 } : {}) });
        if (!begin.allowed) {
          setBusinessResult(response, "quota_rejected", begin.reasonCode);
          if (begin.rateRemaining !== undefined) response.setHeader("RateLimit-Remaining", begin.rateRemaining.toString());
          if (begin.rateResetAt !== undefined) {
            response.setHeader("RateLimit-Reset", Math.ceil(begin.rateResetAt / 1_000).toString());
            response.setHeader("Retry-After", Math.max(1, Math.ceil((begin.rateResetAt - Date.now()) / 1_000)).toString());
          }
          response.status(begin.statusCode).json({ error: publicQuotaError(begin.reasonCode) });
          return;
        }

        response.setHeader("RateLimit-Remaining", begin.rateRemaining.toString());
        response.setHeader("RateLimit-Reset", Math.ceil(begin.rateResetAt / 1_000).toString());

        let detailed: RuntimeResult | undefined;
        try {
          detailed = await dependencies.runtime.evaluateDetailed(parsed.data, principal);
          await protection.finishDiscovery(begin.context, {
            statusCode: 200,
            businessStatus: detailed.result.status,
            reasonCode: detailed.result.reasonCode,
            trace: detailed.trace,
            conservative: detailed.result.status === "unavailable"
          });
          response.locals.monitoringRecorded = true;
          response.json({ success: true, data: detailed.result });
        } catch (error) {
          await protection.finishDiscovery(begin.context, {
            statusCode: 503,
            businessStatus: "unavailable",
            reasonCode: safeErrorCode(error),
            ...(detailed?.trace ? { trace: detailed.trace } : {}),
            conservative: true
          });
          response.locals.monitoringRecorded = true;
          throw error;
        }
      } catch (error) {
        next(error);
      }
    }
  );

  if (dependencies.chatService && dependencies.workflowService && dependencies.workflowStore) {
    registerWorkflowRoutes(app, {
      config: dependencies.config,
      runtime: dependencies.runtime,
      ...(dependencies.sessionResolver ? { sessionResolver: dependencies.sessionResolver } : {}),
      chatService: dependencies.chatService,
      workflowService: dependencies.workflowService,
      workflowStore: dependencies.workflowStore
    }, protection);
  }

  app.get(
    "/internal/usage/summary",
    requireInternalIdentity(dependencies.config),
    requireAdmin(dependencies.config),
    async (request, response, next) => {
      try {
        const date = readDate(request.query.date);
        response.json({ success: true, data: await monitoringStore.summary(date), llmEnabled: await protectionStore.getLlmEnabled() });
      } catch (error) {
        next(error);
      }
    }
  );

  app.get(
    "/internal/usage/requests",
    requireInternalIdentity(dependencies.config),
    requireAdmin(dependencies.config),
    async (request, response, next) => {
      try {
        const endpointRaw = typeof request.query.endpointId === "string" ? request.query.endpointId : undefined;
        if (endpointRaw && !isEndpointId(endpointRaw)) throw new InvalidAdminQueryError();
        const endpointId: EndpointId | undefined = endpointRaw && isEndpointId(endpointRaw) ? endpointRaw : undefined;
        const statusRaw = typeof request.query.status === "string" ? Number(request.query.status) : undefined;
        const statusCode = statusRaw === undefined || Number.isInteger(statusRaw) ? statusRaw : undefined;
        const cursor = boundedInteger(request.query.cursor, 0, 1_000_000, 0);
        const limit = boundedInteger(request.query.limit, 1, 100, 50);
        response.json({
          success: true,
          data: await monitoringStore.list({
            date: readDate(request.query.date),
            ...(endpointId ? { endpointId } : {}),
            ...(statusCode !== undefined ? { statusCode } : {}),
            cursor,
            limit
          })
        });
      } catch (error) {
        next(error);
      }
    }
  );

  app.get(
    "/internal/usage/top-consumers",
    requireInternalIdentity(dependencies.config),
    requireAdmin(dependencies.config),
    async (request, response, next) => {
      try {
        const summary = await monitoringStore.summary(readDate(request.query.date));
        response.json({ success: true, data: { date: summary.date, topUsers: summary.topUsers, topIps: summary.topIps } });
      } catch (error) {
        next(error);
      }
    }
  );

  app.post(
    "/internal/controls/llm-mode",
    requireInternalIdentity(dependencies.config),
    requireAdmin(dependencies.config),
    async (request, response, next) => {
      try {
        const parsed = z.object({ enabled: z.boolean() }).strict().safeParse(request.body);
        if (!parsed.success) throw new InvalidAdminQueryError();
        await protectionStore.setLlmEnabled(parsed.data.enabled);
        const principal = request.principal!;
        console.info(
          JSON.stringify({
            type: "security_control_audit",
            control: "llm-enabled",
            enabled: parsed.data.enabled,
            actorHash: hashIdentifier(principal.userId, dependencies.config.identity.ipHashSecret!),
            timestamp: new Date().toISOString()
          })
        );
        response.json({ success: true, data: { enabled: parsed.data.enabled } });
      } catch (error) {
        next(error);
      }
    }
  );

  app.use((_request, response) => {
    response.status(404).json({ error: { code: "NOT_FOUND", message: "接口不存在" } });
  });

  app.use(workflowErrorMiddleware);

  app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    if (error instanceof FixtureError) {
      response.status(error.code === "FIXTURE_NOT_FOUND" ? 404 : 400).json({
        error: { code: error.code, message: "测试数据不可用" }
      });
      return;
    }
    if (error instanceof InvalidAdminQueryError) {
      response.status(400).json({ error: { code: "INVALID_ADMIN_QUERY", message: "查询参数无效" } });
      return;
    }
    if (error instanceof ProtectionStoreUnavailableError || error instanceof MonitoringStoreUnavailableError) {
      response.status(503).json({ error: { code: error.code, message: "安全计量服务暂时不可用" } });
      return;
    }
    if (error instanceof SyntaxError) {
      response.status(400).json({ error: { code: "INVALID_JSON", message: "请求 JSON 无法解析" } });
      return;
    }

    console.error("Unhandled API error", safeErrorName(error));
    response.status(500).json({ error: { code: "INTERNAL_ERROR", message: "服务暂时不可用" } });
  });

  return app;
}

function securityHeaders(config: AppConfig) {
  return (_request: Request, response: Response, next: NextFunction) => {
    response.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("X-Frame-Options", "DENY");
    response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
    response.setHeader("Cache-Control", "no-store");
    if (config.publicDeployment || config.nodeEnv === "production") {
      response.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    }
    next();
  };
}

function corsMiddleware(allowedOrigins: string[]) {
  const allowed = new Set(allowedOrigins);
  return (request: Request, response: Response, next: NextFunction) => {
    const origin = request.header("origin");
    if (origin && !allowed.has(origin)) {
      response.status(403).json({ error: { code: "ORIGIN_FORBIDDEN", message: "请求来源不被允许" } });
      return;
    }
    if (origin) {
      response.setHeader("Access-Control-Allow-Origin", origin);
      response.setHeader("Vary", "Origin");
      response.setHeader(
        "Access-Control-Allow-Headers",
        "Authorization, Content-Type, Idempotency-Key, X-Unseen-User-Id, X-Unseen-Session-Id, X-Unseen-User-Role, X-Unseen-User-Status, X-Unseen-Auth-Timestamp, X-Unseen-Auth-Signature"
      );
      response.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, OPTIONS");
      response.setHeader("Access-Control-Max-Age", "600");
    }
    if (request.method === "OPTIONS") {
      response.sendStatus(origin ? 204 : 403);
      return;
    }
    next();
  };
}

function contentLengthGuard(maxBytes: number) {
  return (request: Request, response: Response, next: NextFunction) => {
    const raw = request.header("content-length");
    if (raw && (!/^\d+$/.test(raw) || Number(raw) > maxBytes)) {
      response.status(413).json({ error: { code: "PAYLOAD_TOO_LARGE", message: "请求内容过大" } });
      return;
    }
    next();
  };
}

function clientIdentityHash(config: AppConfig) {
  return (request: Request, _response: Response, next: NextFunction) => {
    if (config.identity.ipHashSecret) request.clientIpHash = hashIdentifier(request.ip ?? "unknown", config.identity.ipHashSecret);
    next();
  };
}

function basicMonitoring(store: MonitoringStore, config: AppConfig) {
  return (request: Request, response: Response, next: NextFunction) => {
    const startedAt = Date.now();
    const fallbackRequestId = randomUUID();
    response.on("finish", () => {
      if (response.locals.monitoringRecorded || request.path === "/health") return;
      const secret = config.identity.ipHashSecret;
      const event: UsageEvent = {
        requestId: fallbackRequestId,
        timestamp: new Date().toISOString(),
        endpointId: endpointForPath(request.path),
        userIdHash: request.principal && secret ? hashIdentifier(request.principal.userId, secret) : null,
        ipHash: request.clientIpHash ?? "unavailable",
        sessionIdHash: request.principal && secret ? hashIdentifier(request.principal.sessionId, secret) : null,
        statusCode: response.statusCode,
        businessStatus: response.locals.businessStatus ?? "request_rejected",
        durationMs: Math.max(0, Date.now() - startedAt),
        llm: { provider: "none", model: "none", requests: 0, retries: 0, inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 },
        zhihu: { searchRequests: 0, userDataRequests: 0 },
        quotaDecision: response.statusCode === 429 || response.statusCode === 503 ? "rejected" : "not_applicable",
        reasonCode: response.locals.reasonCode ?? `HTTP_${response.statusCode}`
      };
      void store.record(event).catch((error) => console.error("Monitoring write failed", safeErrorName(error)));
    });
    next();
  };
}

function setBusinessResult(response: Response, businessStatus: string, reasonCode: string): void {
  response.locals.businessStatus = businessStatus;
  response.locals.reasonCode = reasonCode;
}

function publicQuotaError(code: string) {
  if (code === "SHORT_RATE_LIMITED") return { code, message: "请求过于频繁，请稍后再试" };
  if (code === "DAILY_QUOTA_EXCEEDED") return { code, message: "今天的使用额度已经用完" };
  if (code === "IDEMPOTENCY_REPLAY") return { code, message: "相同请求正在处理或已经提交" };
  if (code === "CONCURRENCY_LIMITED") return { code, message: "已有任务正在处理，请稍后再试" };
  if (code === "LLM_DISABLED") return { code, message: "真实模型调用暂时关闭" };
  return { code: "SERVICE_BUDGET_UNAVAILABLE", message: "服务暂时不可用" };
}

function endpointForPath(path: string): EndpointId {
  if (path === "/api/chat/reply") return "chat.reply";
  if (path.includes("/discovery")) return "discovery.evaluate";
  if (path === "/api/papers/drafts") return "paper.draft";
  if (path.endsWith("/confirm")) return "paper.confirm";
  if (path.endsWith("/withdraw")) return "paper.withdraw";
  if (path.startsWith("/api/papers/")) return "paper.edit";
  if (path === "/api/handoffs") return "handoff.create";
  if (path === "/api/profile/summary") return "profile.summarize";
  if (path === "/api/discovery/evaluate") return "discovery.evaluate";
  if (path === "/internal/controls/llm-mode") return "internal.controls.llm-mode";
  if (path.startsWith("/internal/usage")) return "internal.usage";
  return "health.read";
}

function readDate(value: unknown): string {
  if (value === undefined) return new Date().toISOString().slice(0, 10);
  if (typeof value !== "string" || !usageDatePattern.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw new InvalidAdminQueryError();
  }
  return value;
}

function boundedInteger(value: unknown, min: number, max: number, fallback: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || !/^\d+$/.test(value)) throw new InvalidAdminQueryError();
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) throw new InvalidAdminQueryError();
  return parsed;
}

function safeErrorCode(error: unknown): string {
  if (error && typeof error === "object" && "code" in error && typeof error.code === "string") return error.code;
  return "PIPELINE_FAILED";
}

function safeErrorName(error: unknown): string {
  return error instanceof Error ? error.name : "UnknownError";
}

class InvalidAdminQueryError extends Error {}
