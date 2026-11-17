import type { RedisClientType } from "redis";
import type {
  ActualUsage,
  RateLimitDecision,
  RateLimitRule,
  Reservation,
  ReservationDecision,
  ReservationRequest
} from "./types.js";

export interface ProtectionStore {
  consumeRateLimits(rules: RateLimitRule[], nowMs?: number): Promise<RateLimitDecision>;
  reserve(request: ReservationRequest): Promise<ReservationDecision>;
  settle(reservation: Reservation, actual: ActualUsage, conservative: boolean): Promise<void>;
  claimIdempotency(key: string, ttlMs: number): Promise<boolean>;
  getLlmEnabled(): Promise<boolean>;
  setLlmEnabled(enabled: boolean): Promise<void>;
  close?(): Promise<void>;
}

interface WindowEntry {
  count: number;
  resetAt: number;
}

export class InMemoryProtectionStore implements ProtectionStore {
  private readonly windows = new Map<string, WindowEntry>();
  private readonly budgets = new Map<string, number>();
  private readonly reservations = new Map<string, Reservation>();
  private readonly concurrency = new Map<string, Map<string, number>>();
  private readonly idempotency = new Map<string, number>();
  private llmEnabled = true;
  available = true;

  async consumeRateLimits(rules: RateLimitRule[], nowMs = Date.now()): Promise<RateLimitDecision> {
    this.assertAvailable();
    let resetAt = nowMs;
    let remaining = Number.MAX_SAFE_INTEGER;
    const entries = rules.map((rule) => {
      const existing = this.windows.get(rule.key);
      const entry = !existing || existing.resetAt <= nowMs ? { count: 0, resetAt: nowMs + rule.windowMs } : existing;
      return { rule, entry };
    });

    const blocked = entries.find(({ rule, entry }) => entry.count >= rule.limit);
    if (blocked) {
      return {
        allowed: false,
        remaining: 0,
        resetAt: blocked.entry.resetAt,
        reasonCode: "SHORT_RATE_LIMITED"
      };
    }

    for (const { rule, entry } of entries) {
      entry.count += 1;
      this.windows.set(rule.key, entry);
      resetAt = Math.max(resetAt, entry.resetAt);
      remaining = Math.min(remaining, Math.max(0, rule.limit - entry.count));
    }
    return { allowed: true, remaining, resetAt };
  }

  async reserve(request: ReservationRequest): Promise<ReservationDecision> {
    this.assertAvailable();
    if (request.requiresLlm !== false && !this.llmEnabled) return { allowed: false, reasonCode: "LLM_DISABLED" };
    const nowMs = request.nowMs ?? Date.now();
    this.cleanup(nowMs);

    for (const item of request.budgetItems) {
      const current = this.budgets.get(item.key) ?? 0;
      if (current + item.amount > item.limit) {
        return {
          allowed: false,
          reasonCode: item.key.includes(":global:") ? "GLOBAL_BUDGET_EXCEEDED" : "DAILY_QUOTA_EXCEEDED"
        };
      }
    }
    for (const item of request.concurrency) {
      const active = this.concurrency.get(item.key)?.size ?? 0;
      if (active >= item.limit) return { allowed: false, reasonCode: "CONCURRENCY_LIMITED" };
    }

    const expiresAt = nowMs + request.leaseMs;
    const reservation: Reservation = {
      reservationId: request.reservationId,
      budgetItems: request.budgetItems.map((item) => ({ ...item })),
      concurrencyKeys: request.concurrency.map((item) => item.key),
      expiresAt
    };
    for (const item of request.budgetItems) {
      this.budgets.set(item.key, (this.budgets.get(item.key) ?? 0) + item.amount);
    }
    for (const item of request.concurrency) {
      const leases = this.concurrency.get(item.key) ?? new Map<string, number>();
      leases.set(request.reservationId, expiresAt);
      this.concurrency.set(item.key, leases);
    }
    this.reservations.set(request.reservationId, reservation);
    return { allowed: true, reservation };
  }

  async settle(reservation: Reservation, actual: ActualUsage, conservative: boolean): Promise<void> {
    this.assertAvailable();
    const existing = this.reservations.get(reservation.reservationId);
    if (!existing) return;

    if (!conservative) {
      const actualBySuffix: Record<string, number> = {
        discovery_workflow: actual.discoveryWorkflows,
        llm_request: actual.llmRequests,
        llm_input_token: actual.llmInputTokens,
        llm_output_token: actual.llmOutputTokens,
        zhihu_search_request: actual.zhihuSearchRequests,
        zhihu_user_data_request: actual.zhihuUserDataRequests ?? 0
      };
      for (const item of existing.budgetItems) {
        const suffix = Object.keys(actualBySuffix).find((name) => item.key.endsWith(`:${name}`));
        if (!suffix) continue;
        const refund = Math.max(0, item.amount - (actualBySuffix[suffix] ?? item.amount));
        this.budgets.set(item.key, Math.max(0, (this.budgets.get(item.key) ?? 0) - refund));
      }
    }

    for (const key of existing.concurrencyKeys) this.concurrency.get(key)?.delete(existing.reservationId);
    this.reservations.delete(existing.reservationId);
  }

  async claimIdempotency(key: string, ttlMs: number): Promise<boolean> {
    this.assertAvailable();
    const nowMs = Date.now();
    const expiresAt = this.idempotency.get(key);
    if (expiresAt && expiresAt > nowMs) return false;
    this.idempotency.set(key, nowMs + ttlMs);
    return true;
  }

  async getLlmEnabled(): Promise<boolean> {
    this.assertAvailable();
    return this.llmEnabled;
  }

  async setLlmEnabled(enabled: boolean): Promise<void> {
    this.assertAvailable();
    this.llmEnabled = enabled;
  }

  private cleanup(nowMs: number): void {
    for (const [key, leases] of this.concurrency) {
      for (const [reservationId, expiresAt] of leases) {
        if (expiresAt <= nowMs) leases.delete(reservationId);
      }
      if (leases.size === 0) this.concurrency.delete(key);
    }
    for (const [key, expiresAt] of this.idempotency) {
      if (expiresAt <= nowMs) this.idempotency.delete(key);
    }
  }

  private assertAvailable(): void {
    if (!this.available) throw new ProtectionStoreUnavailableError();
  }
}

const RATE_LIMIT_SCRIPT = `
for i = 1, #KEYS do
  local count = tonumber(redis.call('GET', KEYS[i]) or '0')
  local limit = tonumber(ARGV[(i - 1) * 2 + 1])
  if count >= limit then
    local ttl = redis.call('PTTL', KEYS[i])
    return {0, 0, ttl}
  end
end
local minRemaining = 2147483647
local maxTtl = 0
for i = 1, #KEYS do
  local limit = tonumber(ARGV[(i - 1) * 2 + 1])
  local windowMs = tonumber(ARGV[(i - 1) * 2 + 2])
  local count = redis.call('INCR', KEYS[i])
  if count == 1 then redis.call('PEXPIRE', KEYS[i], windowMs) end
  local remaining = limit - count
  if remaining < minRemaining then minRemaining = remaining end
  local ttl = redis.call('PTTL', KEYS[i])
  if ttl > maxTtl then maxTtl = ttl end
end
return {1, minRemaining, maxTtl}
`;

const RESERVE_SCRIPT = `
local budgetCount = tonumber(ARGV[1])
local concurrencyCount = tonumber(ARGV[2])
local reservationId = ARGV[3]
local expiresAt = tonumber(ARGV[4])
local dailyTtlSeconds = tonumber(ARGV[5])
local leaseMs = tonumber(ARGV[6])
local offset = 7
for i = 1, budgetCount do
  local amount = tonumber(ARGV[offset])
  local limit = tonumber(ARGV[offset + 1])
  offset = offset + 2
  local current = tonumber(redis.call('GET', KEYS[i]) or '0')
  if current + amount > limit then return {0, i, 0} end
end
for i = 1, concurrencyCount do
  local keyIndex = budgetCount + i
  local limit = tonumber(ARGV[offset])
  offset = offset + 1
  redis.call('ZREMRANGEBYSCORE', KEYS[keyIndex], '-inf', expiresAt - leaseMs)
  if redis.call('ZCARD', KEYS[keyIndex]) >= limit then return {0, keyIndex, 1} end
end
for i = 1, budgetCount do
  local amount = tonumber(ARGV[7 + (i - 1) * 2])
  redis.call('INCRBY', KEYS[i], amount)
  redis.call('EXPIRE', KEYS[i], dailyTtlSeconds)
end
for i = 1, concurrencyCount do
  local keyIndex = budgetCount + i
  redis.call('ZADD', KEYS[keyIndex], expiresAt, reservationId)
  redis.call('PEXPIRE', KEYS[keyIndex], leaseMs + 60000)
end
local markerKey = KEYS[#KEYS]
redis.call('SET', markerKey, '1', 'PX', leaseMs + 60000)
return {1, 0, 0}
`;

const SETTLE_SCRIPT = `
local markerKey = KEYS[#KEYS]
if redis.call('EXISTS', markerKey) == 0 then return 0 end
local budgetCount = tonumber(ARGV[1])
local concurrencyCount = tonumber(ARGV[2])
local reservationId = ARGV[3]
for i = 1, budgetCount do
  local refund = tonumber(ARGV[3 + i])
  if refund > 0 then
    local value = tonumber(redis.call('DECRBY', KEYS[i], refund))
    if value < 0 then redis.call('SET', KEYS[i], 0) end
  end
end
for i = 1, concurrencyCount do
  redis.call('ZREM', KEYS[budgetCount + i], reservationId)
end
redis.call('DEL', markerKey)
return 1
`;

export class RedisProtectionStore implements ProtectionStore {
  constructor(
    private readonly client: RedisClientType,
    private readonly prefix = "unseen"
  ) {}

  async consumeRateLimits(rules: RateLimitRule[], nowMs = Date.now()): Promise<RateLimitDecision> {
    if (rules.length === 0) return { allowed: true, remaining: Number.MAX_SAFE_INTEGER, resetAt: nowMs };
    try {
      const result = (await this.client.eval(RATE_LIMIT_SCRIPT, {
        keys: rules.map((rule) => `${this.prefix}:rate:${rule.key}`),
        arguments: rules.flatMap((rule) => [rule.limit.toString(), rule.windowMs.toString()])
      })) as number[];
      const allowed = result[0] === 1;
      const ttl = Math.max(0, result[2] ?? 0);
      return {
        allowed,
        remaining: result[1] ?? 0,
        resetAt: nowMs + ttl,
        ...(allowed ? {} : { reasonCode: "SHORT_RATE_LIMITED" })
      };
    } catch (error) {
      throw new ProtectionStoreUnavailableError(error);
    }
  }

  async reserve(request: ReservationRequest): Promise<ReservationDecision> {
    try {
      if (request.requiresLlm !== false && !(await this.getLlmEnabled())) return { allowed: false, reasonCode: "LLM_DISABLED" };
      const nowMs = request.nowMs ?? Date.now();
      const expiresAt = nowMs + request.leaseMs;
      const markerKey = `${this.prefix}:reservation:${request.reservationId}`;
      const keys = [
        ...request.budgetItems.map((item) => `${this.prefix}:budget:${item.key}`),
        ...request.concurrency.map((item) => `${this.prefix}:concurrency:${item.key}`),
        markerKey
      ];
      const result = (await this.client.eval(RESERVE_SCRIPT, {
        keys,
        arguments: [
          request.budgetItems.length.toString(),
          request.concurrency.length.toString(),
          request.reservationId,
          expiresAt.toString(),
          secondsUntilTwoDaysFromNow(nowMs).toString(),
          request.leaseMs.toString(),
          ...request.budgetItems.flatMap((item) => [item.amount.toString(), item.limit.toString()]),
          ...request.concurrency.map((item) => item.limit.toString())
        ]
      })) as number[];
      if (result[0] !== 1) {
        if (result[2] === 1) return { allowed: false, reasonCode: "CONCURRENCY_LIMITED" };
        const rejectedIndex = (result[1] ?? 1) - 1;
        const item = request.budgetItems[rejectedIndex];
        return {
          allowed: false,
          reasonCode: item?.key.includes(":global:") ? "GLOBAL_BUDGET_EXCEEDED" : "DAILY_QUOTA_EXCEEDED"
        };
      }
      return {
        allowed: true,
        reservation: {
          reservationId: request.reservationId,
          budgetItems: request.budgetItems.map((item) => ({ ...item })),
          concurrencyKeys: request.concurrency.map((item) => item.key),
          expiresAt
        }
      };
    } catch (error) {
      if (error instanceof ProtectionStoreUnavailableError) throw error;
      throw new ProtectionStoreUnavailableError(error);
    }
  }

  async settle(reservation: Reservation, actual: ActualUsage, conservative: boolean): Promise<void> {
    const actualBySuffix: Record<string, number> = {
      discovery_workflow: actual.discoveryWorkflows,
      llm_request: actual.llmRequests,
      llm_input_token: actual.llmInputTokens,
      llm_output_token: actual.llmOutputTokens,
      zhihu_search_request: actual.zhihuSearchRequests,
      zhihu_user_data_request: actual.zhihuUserDataRequests ?? 0
    };
    const refunds = reservation.budgetItems.map((item) => {
      if (conservative) return 0;
      const suffix = Object.keys(actualBySuffix).find((name) => item.key.endsWith(`:${name}`));
      return suffix ? Math.max(0, item.amount - (actualBySuffix[suffix] ?? item.amount)) : 0;
    });
    try {
      await this.client.eval(SETTLE_SCRIPT, {
        keys: [
          ...reservation.budgetItems.map((item) => `${this.prefix}:budget:${item.key}`),
          ...reservation.concurrencyKeys.map((key) => `${this.prefix}:concurrency:${key}`),
          `${this.prefix}:reservation:${reservation.reservationId}`
        ],
        arguments: [
          reservation.budgetItems.length.toString(),
          reservation.concurrencyKeys.length.toString(),
          reservation.reservationId,
          ...refunds.map(String)
        ]
      });
    } catch (error) {
      throw new ProtectionStoreUnavailableError(error);
    }
  }

  async claimIdempotency(key: string, ttlMs: number): Promise<boolean> {
    try {
      const result = await this.client.set(`${this.prefix}:idempotency:${key}`, "1", { PX: ttlMs, NX: true });
      return result === "OK";
    } catch (error) {
      throw new ProtectionStoreUnavailableError(error);
    }
  }

  async getLlmEnabled(): Promise<boolean> {
    try {
      return (await this.client.get(`${this.prefix}:controls:llm-enabled`)) !== "false";
    } catch (error) {
      throw new ProtectionStoreUnavailableError(error);
    }
  }

  async setLlmEnabled(enabled: boolean): Promise<void> {
    try {
      await this.client.set(`${this.prefix}:controls:llm-enabled`, enabled ? "true" : "false");
    } catch (error) {
      throw new ProtectionStoreUnavailableError(error);
    }
  }
}

export class ProtectionStoreUnavailableError extends Error {
  readonly code = "BUDGET_SERVICE_UNAVAILABLE";

  constructor(public readonly cause?: unknown) {
    super("Shared protection store is unavailable");
    this.name = "ProtectionStoreUnavailableError";
  }
}

function secondsUntilTwoDaysFromNow(nowMs: number): number {
  return Math.ceil((startOfUtcDay(nowMs) + 2 * 86_400_000 - nowMs) / 1_000);
}

function startOfUtcDay(nowMs: number): number {
  const date = new Date(nowMs);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}
