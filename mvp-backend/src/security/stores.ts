import { createClient } from "redis";
import type { AppConfig } from "../config.js";
import { InMemoryMonitoringStore, RedisMonitoringStore, type MonitoringStore } from "./monitoring-store.js";
import { InMemoryProtectionStore, RedisProtectionStore, type ProtectionStore } from "./protection-store.js";

export interface SecurityStores {
  protectionStore: ProtectionStore;
  monitoringStore: MonitoringStore;
  close(): Promise<void>;
}

export async function createSecurityStores(config: AppConfig): Promise<SecurityStores> {
  if (config.securityStore.mode === "memory") {
    return {
      protectionStore: new InMemoryProtectionStore(),
      monitoringStore: new InMemoryMonitoringStore(),
      async close() {}
    };
  }

  const redisUrl = config.securityStore.redisUrl;
  if (!redisUrl) throw new Error("Redis URL is required for the Redis security store");
  const client = createClient({ url: redisUrl });
  client.on("error", (error) => console.error("Redis security store error", error instanceof Error ? error.name : "UnknownError"));
  await client.connect();
  return {
    protectionStore: new RedisProtectionStore(client, config.securityStore.redisPrefix),
    monitoringStore: new RedisMonitoringStore(
      client,
      config.monitoring.retentionDays,
      config.monitoring.maxEventsPerDay,
      config.securityStore.redisPrefix
    ),
    async close() {
      if (client.isOpen) await client.quit();
    }
  };
}
