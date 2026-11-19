import { z } from "zod";

const booleanString = z
  .enum(["true", "false"])
  .default("false")
  .transform((value) => value === "true");

const optionalSecret = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().min(32).optional()
);

const optionalUrl = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().url().optional()
);

const configSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    CANDIDATE_MODE: z.enum(["fixture", "routed"]).default("fixture"),
    AUTH_MODE: z.enum(["signed", "session"]).default("signed"),
    PROFILE_SUMMARY_ENABLED: booleanString,
    ZHIHU_USER_DATA_MIN_INTERVAL_MS: z.coerce.number().int().min(1_000).max(10_000).default(2_000),
    ZHIHU_USER_DATA_COOLDOWN_MS: z.coerce.number().int().min(1_000).max(86_400_000).default(60_000),
    ZHIHU_USER_DATA_QUOTA_COOLDOWN_MS: z.coerce.number().int().min(60_000).max(86_400_000).default(900_000),
    ZHIHU_USER_DATA_CACHE_TTL_MS: z.coerce.number().int().min(0).max(900_000).default(300_000),
    ZHIHU_PUBLIC_SEARCH_ENABLED: booleanString,
    ZHIHU_PUBLIC_DEMO_TIME_ENABLED: booleanString,
    ZHIHU_PUBLIC_SEARCH_TRANSPORT: z.enum(["http", "local_cli"]).default("http"),
    ZHIHU_CLI_PATH: z.string().optional(),
    ZHIHU_ACCESS_SECRET: z.string().optional(),
    TOKEN_ENCRYPTION_KEY: optionalSecret,
    SUPABASE_URL: optionalUrl,
    SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
    HOST: z.string().default("127.0.0.1"),
    PORT: z.coerce.number().int().min(1).max(65_535).default(8_787),
    LLM_MODE: z.enum(["mock", "live"]).default("mock"),
    LLM_API_KEY: z.string().optional(),
    LLM_BASE_URL: z.string().url().default("https://api.openai.com/v1"),
    LLM_ALLOWED_HOSTS: z.string().default("api.openai.com"),
    LLM_MODEL: z.string().optional(),
    LLM_TIMEOUT_MS: z.coerce.number().int().min(500).max(60_000).default(12_000),
    LLM_MAX_RETRIES: z.coerce.number().int().min(0).max(2).default(1),
    LLM_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(64).max(4_096).optional(),
    LLM_REASONING_EFFORT: z.enum(["low", "high", "max"]).optional(),
    LLM_INPUT_TOKEN_RESERVE: z.coerce.number().int().min(1_000).max(100_000).default(24_000),
    LLM_INPUT_COST_PER_MILLION_USD: z.coerce.number().min(0).max(1_000).default(0),
    LLM_OUTPUT_COST_PER_MILLION_USD: z.coerce.number().min(0).max(1_000).default(0),
    PIPELINE_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(90_000).default(25_000),
    APP_API_TOKEN: optionalSecret,
    IDENTITY_SIGNING_SECRET: optionalSecret,
    IP_HASH_SECRET: optionalSecret,
    ADMIN_USER_IDS: z.string().default(""),
    PUBLIC_DEPLOYMENT: booleanString,
    PUBLIC_SECURITY_UNLOCK: booleanString,
    CORS_ORIGINS: z.string().default(""),
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(3).default(0),
    REQUEST_BODY_LIMIT: z.string().regex(/^\d+(kb|mb)$/i).default("32kb"),
    REQUEST_CONTENT_LENGTH_MAX: z.coerce.number().int().min(1_024).max(1_048_576).default(32_768),
    SECURITY_STORE_MODE: z.enum(["memory", "redis"]).default("memory"),
    BUSINESS_STORE_MODE: z.enum(["memory", "supabase"]).optional(),
    REDIS_URL: optionalUrl,
    REDIS_PREFIX: z.string().regex(/^[a-z0-9:_-]{1,40}$/i).default("unseen"),
    MAILBOX_RATE_USER_MAX: z.coerce.number().int().min(1).max(1000).default(30),
    MAILBOX_RATE_IP_MAX: z.coerce.number().int().min(1).max(10000).default(120),
    DAILY_USER_MAILBOX_ACTIONS: z.coerce.number().int().min(1).max(10000).default(200),
    DAILY_IP_MAILBOX_ACTIONS: z.coerce.number().int().min(1).max(100000).default(500),
    RATE_IP_MAX: z.coerce.number().int().min(1).max(10_000).default(10),
    RATE_IP_WINDOW_MS: z.coerce.number().int().min(1_000).max(3_600_000).default(600_000),
    RATE_USER_MAX: z.coerce.number().int().min(1).max(10_000).default(3),
    RATE_USER_WINDOW_MS: z.coerce.number().int().min(1_000).max(3_600_000).default(60_000),
    DAILY_USER_WORKFLOWS: z.coerce.number().int().min(1).max(10_000).default(10),
    DAILY_IP_WORKFLOWS: z.coerce.number().int().min(1).max(100_000).default(30),
    DAILY_USER_LLM_REQUESTS: z.coerce.number().int().min(1).max(100_000).default(30),
    DAILY_GLOBAL_LLM_REQUESTS: z.coerce.number().int().min(1).max(10_000_000).default(1_000),
    DAILY_USER_ZHIHU_DATA_REQUESTS: z.coerce.number().int().min(1).max(1000).default(20),
    DAILY_GLOBAL_ZHIHU_DATA_REQUESTS: z.coerce.number().int().min(1).max(100000).default(200),
    DAILY_USER_ZHIHU_SEARCH_REQUESTS: z.coerce.number().int().min(1).max(1000).default(10),
    DAILY_GLOBAL_ZHIHU_SEARCH_REQUESTS: z.coerce.number().int().min(1).max(100000).default(200),
    DAILY_USER_INPUT_TOKENS: z.coerce.number().int().min(1_000).max(100_000_000).default(240_000),
    DAILY_USER_OUTPUT_TOKENS: z.coerce.number().int().min(1_000).max(100_000_000).default(30_000),
    DAILY_GLOBAL_INPUT_TOKENS: z.coerce.number().int().min(1_000).max(2_000_000_000).default(12_000_000),
    DAILY_GLOBAL_OUTPUT_TOKENS: z.coerce.number().int().min(1_000).max(2_000_000_000).default(1_500_000),
    USER_CONCURRENCY_MAX: z.coerce.number().int().min(1).max(20).default(1),
    GLOBAL_CONCURRENCY_MAX: z.coerce.number().int().min(1).max(1_000).default(5),
    RESERVATION_LEASE_MS: z.coerce.number().int().min(5_000).max(300_000).default(90_000),
    IDEMPOTENCY_TTL_MS: z.coerce.number().int().min(1_000).max(86_400_000).default(300_000),
    MONITOR_RETENTION_DAYS: z.coerce.number().int().min(1).max(365).default(30),
    MONITOR_MAX_EVENTS_PER_DAY: z.coerce.number().int().min(100).max(1_000_000).default(20_000)
  })
  .transform((value) => ({
    nodeEnv: value.NODE_ENV,
    candidateMode: value.CANDIDATE_MODE,
    authMode: value.AUTH_MODE,
    profile: { enabled: value.PROFILE_SUMMARY_ENABLED, accessSecret: value.ZHIHU_ACCESS_SECRET, encryptionKey: value.TOKEN_ENCRYPTION_KEY,
      userDataPolicy: { minIntervalMs: value.ZHIHU_USER_DATA_MIN_INTERVAL_MS, cooldownMs: value.ZHIHU_USER_DATA_COOLDOWN_MS,
        quotaCooldownMs: value.ZHIHU_USER_DATA_QUOTA_COOLDOWN_MS, cacheTtlMs: value.ZHIHU_USER_DATA_CACHE_TTL_MS } },
    publicSearchEnabled: value.ZHIHU_PUBLIC_SEARCH_ENABLED,
    publicDemoTimeEnabled: value.ZHIHU_PUBLIC_DEMO_TIME_ENABLED,
    publicSearchTransport: value.ZHIHU_PUBLIC_SEARCH_TRANSPORT,
    zhihuCliPath: value.ZHIHU_CLI_PATH,
    supabase: { url: value.SUPABASE_URL, serviceKey: value.SUPABASE_SERVICE_ROLE_KEY },
    host: value.HOST,
    port: value.PORT,
    llm: {
      mode: value.LLM_MODE,
      apiKey: value.LLM_API_KEY,
      baseUrl: value.LLM_BASE_URL,
      allowedHosts: splitCsv(value.LLM_ALLOWED_HOSTS),
      model: value.LLM_MODEL,
      timeoutMs: value.LLM_TIMEOUT_MS,
      maxRetries: value.LLM_MAX_RETRIES,
      maxOutputTokens: value.LLM_MAX_OUTPUT_TOKENS ?? (value.LLM_MODEL?.toLowerCase() === "glm-5.3" ? 4_096 : 1_500),
      ...(value.LLM_REASONING_EFFORT || value.LLM_MODEL?.toLowerCase() === "glm-5.3"
        ? { reasoningEffort: value.LLM_REASONING_EFFORT ?? "low" as const } : {}),
      inputTokenReserve: value.LLM_INPUT_TOKEN_RESERVE,
      inputCostPerMillionUsd: value.LLM_INPUT_COST_PER_MILLION_USD,
      outputCostPerMillionUsd: value.LLM_OUTPUT_COST_PER_MILLION_USD
    },
    pipelineTimeoutMs: value.PIPELINE_TIMEOUT_MS,
    appApiToken: value.APP_API_TOKEN,
    identity: {
      signingSecret: value.IDENTITY_SIGNING_SECRET,
      ipHashSecret: value.IP_HASH_SECRET,
      adminUserIds: splitCsv(value.ADMIN_USER_IDS)
    },
    publicDeployment: value.PUBLIC_DEPLOYMENT,
    publicSecurityUnlock: value.PUBLIC_SECURITY_UNLOCK,
    corsOrigins: splitCsv(value.CORS_ORIGINS),
    trustProxyHops: value.TRUST_PROXY_HOPS,
    requestBodyLimit: value.REQUEST_BODY_LIMIT,
    requestContentLengthMax: value.REQUEST_CONTENT_LENGTH_MAX,
    securityStore: {
      mode: value.SECURITY_STORE_MODE,
      redisUrl: value.REDIS_URL,
      redisPrefix: value.REDIS_PREFIX
    },
    businessStoreMode: value.BUSINESS_STORE_MODE ?? (value.AUTH_MODE === "session" ? "supabase" as const : "memory" as const),
    quota: {
      mailboxRateUserMax: value.MAILBOX_RATE_USER_MAX,
      mailboxRateIpMax: value.MAILBOX_RATE_IP_MAX,
      dailyUserMailboxActions: value.DAILY_USER_MAILBOX_ACTIONS,
      dailyIpMailboxActions: value.DAILY_IP_MAILBOX_ACTIONS,
      rateIpMax: value.RATE_IP_MAX,
      rateIpWindowMs: value.RATE_IP_WINDOW_MS,
      rateUserMax: value.RATE_USER_MAX,
      rateUserWindowMs: value.RATE_USER_WINDOW_MS,
      dailyUserWorkflows: value.DAILY_USER_WORKFLOWS,
      dailyIpWorkflows: value.DAILY_IP_WORKFLOWS,
      dailyUserLlmRequests: value.DAILY_USER_LLM_REQUESTS,
      dailyGlobalLlmRequests: value.DAILY_GLOBAL_LLM_REQUESTS,
      dailyUserZhihuDataRequests: value.DAILY_USER_ZHIHU_DATA_REQUESTS,
      dailyGlobalZhihuDataRequests: value.DAILY_GLOBAL_ZHIHU_DATA_REQUESTS,
      dailyUserZhihuSearchRequests: value.DAILY_USER_ZHIHU_SEARCH_REQUESTS,
      dailyGlobalZhihuSearchRequests: value.DAILY_GLOBAL_ZHIHU_SEARCH_REQUESTS,
      dailyUserInputTokens: value.DAILY_USER_INPUT_TOKENS,
      dailyUserOutputTokens: value.DAILY_USER_OUTPUT_TOKENS,
      dailyGlobalInputTokens: value.DAILY_GLOBAL_INPUT_TOKENS,
      dailyGlobalOutputTokens: value.DAILY_GLOBAL_OUTPUT_TOKENS,
      userConcurrencyMax: value.USER_CONCURRENCY_MAX,
      globalConcurrencyMax: value.GLOBAL_CONCURRENCY_MAX,
      reservationLeaseMs: value.RESERVATION_LEASE_MS,
      idempotencyTtlMs: value.IDEMPOTENCY_TTL_MS
    },
    monitoring: {
      retentionDays: value.MONITOR_RETENTION_DAYS,
      maxEventsPerDay: value.MONITOR_MAX_EVENTS_PER_DAY
    }
  }));

export type AppConfig = z.infer<typeof configSchema>;

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): AppConfig {
  const config = configSchema.parse(environment);

  if (config.llm.mode === "live" && (!config.llm.apiKey || !config.llm.model)) {
    throw new Error("LLM_MODE=live requires LLM_API_KEY and LLM_MODEL");
  }
  validateProviderUrl(config.llm.baseUrl, config.llm.allowedHosts);
  if (config.profile.enabled && (!config.profile.accessSecret || !config.profile.encryptionKey || !config.supabase.url || !config.supabase.serviceKey || config.llm.mode !== "live")) {
    throw new Error("Profile summary requires server-side Zhihu credentials, Supabase and live LLM configuration");
  }
  if (config.publicSearchEnabled && config.publicSearchTransport === "http" && !config.profile.accessSecret) throw new Error("Zhihu public search requires ZHIHU_ACCESS_SECRET");
  if (config.publicSearchTransport === "local_cli" && (config.nodeEnv === "production" || config.publicDeployment || !["127.0.0.1", "localhost"].includes(config.host) || !config.zhihuCliPath?.startsWith("/") || /[\r\n]/.test(config.zhihuCliPath))) throw new Error("Local Zhihu CLI requires loopback development and an absolute CLI path");
  if ((config.candidateMode === "routed" || config.authMode === "session") && (!config.supabase.url || !config.supabase.serviceKey)) {
    throw new Error("Routed discovery/session auth requires Supabase server configuration");
  }
  if (config.businessStoreMode === "supabase" && (!config.supabase.url || !config.supabase.serviceKey)) {
    throw new Error("Supabase business store requires Supabase server configuration");
  }
  if (config.candidateMode === "routed" && config.llm.mode !== "live") throw new Error("Routed discovery requires live LLM mode; use fixtures for mock tests");

  if (config.securityStore.mode === "redis" && !config.securityStore.redisUrl) {
    throw new Error("SECURITY_STORE_MODE=redis requires REDIS_URL");
  }

  if (config.host !== "127.0.0.1" && config.host !== "localhost" && !config.appApiToken) {
    throw new Error("Non-loopback HOST requires APP_API_TOKEN");
  }

  if (config.publicDeployment) {
    const missing: string[] = [];
    if (!config.publicSecurityUnlock) missing.push("PUBLIC_SECURITY_UNLOCK=true");
    if (config.securityStore.mode !== "redis" || !config.securityStore.redisUrl) missing.push("Redis security store");
    if (config.businessStoreMode !== "supabase" || !config.supabase.url || !config.supabase.serviceKey) missing.push("Supabase business store");
    if (!config.appApiToken) missing.push("APP_API_TOKEN");
    if (!config.identity.signingSecret) missing.push("IDENTITY_SIGNING_SECRET");
    if (!config.identity.ipHashSecret) missing.push("IP_HASH_SECRET");
    if (config.identity.adminUserIds.length === 0) missing.push("ADMIN_USER_IDS");
    if (config.trustProxyHops === 0) missing.push("TRUST_PROXY_HOPS");
    if (missing.length > 0) {
      throw new Error(`PUBLIC_DEPLOYMENT=true blocked until security requirements are configured: ${missing.join(", ")}`);
    }
  }

  return config;
}

function splitCsv(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function validateProviderUrl(rawUrl: string, allowedHosts: string[]): void {
  const url = new URL(rawUrl);
  if (url.protocol !== "https:" && url.hostname !== "127.0.0.1" && url.hostname !== "localhost") {
    throw new Error("LLM_BASE_URL must use HTTPS outside local development");
  }
  if (!allowedHosts.includes(url.hostname)) {
    throw new Error("LLM_BASE_URL hostname must be listed in LLM_ALLOWED_HOSTS");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("LLM_BASE_URL must not contain credentials, query parameters or fragments");
  }
}
