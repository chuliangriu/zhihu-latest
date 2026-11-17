import type { RedisClientType } from "redis";
import type { EndpointId, UsageEvent, UsageQuery, UsageSummary } from "./types.js";

export interface MonitoringStore {
  ping(): Promise<void>;
  record(event: UsageEvent): Promise<void>;
  list(query: UsageQuery): Promise<{ events: UsageEvent[]; nextCursor: number | null }>;
  summary(date: string): Promise<UsageSummary>;
  close?(): Promise<void>;
}

export class InMemoryMonitoringStore implements MonitoringStore {
  private readonly events: UsageEvent[] = [];
  available = true;

  async ping(): Promise<void> {
    this.assertAvailable();
  }

  async record(event: UsageEvent): Promise<void> {
    this.assertAvailable();
    this.events.push(structuredClone(event));
  }

  async list(query: UsageQuery): Promise<{ events: UsageEvent[]; nextCursor: number | null }> {
    this.assertAvailable();
    const filtered = this.events
      .filter((event) => event.timestamp.slice(0, 10) === query.date)
      .filter((event) => !query.endpointId || event.endpointId === query.endpointId)
      .filter((event) => query.statusCode === undefined || event.statusCode === query.statusCode)
      .reverse();
    const events = filtered.slice(query.cursor, query.cursor + query.limit).map((event) => structuredClone(event));
    const next = query.cursor + events.length;
    return { events, nextCursor: next < filtered.length ? next : null };
  }

  async summary(date: string): Promise<UsageSummary> {
    this.assertAvailable();
    return summarize(date, this.events.filter((event) => event.timestamp.slice(0, 10) === date));
  }

  private assertAvailable(): void {
    if (!this.available) throw new MonitoringStoreUnavailableError();
  }
}

export class RedisMonitoringStore implements MonitoringStore {
  constructor(
    private readonly client: RedisClientType,
    private readonly retentionDays: number,
    private readonly maxEventsPerDay: number,
    private readonly prefix = "unseen"
  ) {}

  async ping(): Promise<void> {
    try {
      await this.client.ping();
    } catch (error) {
      throw new MonitoringStoreUnavailableError(error);
    }
  }

  async record(event: UsageEvent): Promise<void> {
    const date = event.timestamp.slice(0, 10);
    const key = `${this.prefix}:usage:${date}`;
    try {
      const transaction = this.client.multi();
      transaction.rPush(key, JSON.stringify(event));
      transaction.lTrim(key, -this.maxEventsPerDay, -1);
      transaction.expire(key, this.retentionDays * 86_400);
      await transaction.exec();
    } catch (error) {
      throw new MonitoringStoreUnavailableError(error);
    }
  }

  async list(query: UsageQuery): Promise<{ events: UsageEvent[]; nextCursor: number | null }> {
    try {
      const raw = await this.client.lRange(`${this.prefix}:usage:${query.date}`, 0, -1);
      const all = parseEvents(raw)
        .filter((event) => !query.endpointId || event.endpointId === query.endpointId)
        .filter((event) => query.statusCode === undefined || event.statusCode === query.statusCode)
        .reverse();
      const events = all.slice(query.cursor, query.cursor + query.limit);
      const next = query.cursor + events.length;
      return { events, nextCursor: next < all.length ? next : null };
    } catch (error) {
      throw new MonitoringStoreUnavailableError(error);
    }
  }

  async summary(date: string): Promise<UsageSummary> {
    try {
      const raw = await this.client.lRange(`${this.prefix}:usage:${date}`, 0, -1);
      return summarize(date, parseEvents(raw));
    } catch (error) {
      throw new MonitoringStoreUnavailableError(error);
    }
  }
}

export class MonitoringStoreUnavailableError extends Error {
  readonly code = "MONITORING_SERVICE_UNAVAILABLE";

  constructor(public readonly cause?: unknown) {
    super("Monitoring store is unavailable");
    this.name = "MonitoringStoreUnavailableError";
  }
}

function parseEvents(raw: string[]): UsageEvent[] {
  const events: UsageEvent[] = [];
  for (const item of raw) {
    try {
      const decoded = JSON.parse(item) as UsageEvent;
      if (decoded && typeof decoded.requestId === "string" && typeof decoded.endpointId === "string") events.push(decoded);
    } catch {
      // Ignore a corrupt monitoring row instead of exposing it to the admin response.
    }
  }
  return events;
}

function summarize(date: string, events: UsageEvent[]): UsageSummary {
  const statusCounts: Record<string, number> = {};
  const users = new Map<string, { requests: number; llmRequests: number }>();
  const ips = new Map<string, { requests: number; llmRequests: number }>();
  let workflowCount = 0;
  let successCount = 0;
  let llmRequests = 0;
  let llmRetries = 0;
  let llmInputTokens = 0;
  let llmOutputTokens = 0;
  let estimatedCostUsd = 0;
  let zhihuSearchRequests = 0;

  for (const event of events) {
    statusCounts[event.statusCode.toString()] = (statusCounts[event.statusCode.toString()] ?? 0) + 1;
    if (event.endpointId === "discovery.evaluate" && event.quotaDecision === "allowed") workflowCount += 1;
    if (event.statusCode >= 200 && event.statusCode < 400) successCount += 1;
    llmRequests += event.llm.requests;
    llmRetries += event.llm.retries;
    llmInputTokens += event.llm.inputTokens;
    llmOutputTokens += event.llm.outputTokens;
    estimatedCostUsd += event.llm.estimatedCostUsd;
    zhihuSearchRequests += event.zhihu.searchRequests;
    addConsumer(users, event.userIdHash, event.llm.requests);
    addConsumer(ips, event.ipHash, event.llm.requests);
  }

  return {
    date,
    requestCount: events.length,
    workflowCount,
    successCount,
    errorCount: events.length - successCount,
    statusCounts,
    llmRequests,
    llmRetries,
    llmInputTokens,
    llmOutputTokens,
    estimatedCostUsd: Number(estimatedCostUsd.toFixed(6)),
    zhihuSearchRequests,
    topUsers: topConsumers(users),
    topIps: topConsumers(ips)
  };
}

function addConsumer(
  values: Map<string, { requests: number; llmRequests: number }>,
  idHash: string | null,
  llmRequests: number
): void {
  if (!idHash) return;
  const current = values.get(idHash) ?? { requests: 0, llmRequests: 0 };
  current.requests += 1;
  current.llmRequests += llmRequests;
  values.set(idHash, current);
}

function topConsumers(values: Map<string, { requests: number; llmRequests: number }>) {
  return [...values.entries()]
    .map(([idHash, usage]) => ({ idHash, ...usage }))
    .sort((left, right) => right.llmRequests - left.llmRequests || right.requests - left.requests)
    .slice(0, 10);
}

export function isEndpointId(value: string): value is EndpointId {
  return ["health.read","chat.reply","chat.discovery-display","discovery.evaluate","profile.summarize","paper.draft","paper.edit","paper.confirm","paper.withdraw","handoff.create","internal.usage","internal.controls.llm-mode"].includes(value);
}
