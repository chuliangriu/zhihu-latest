import { describe, expect, it } from "vitest";
import { InMemoryProtectionStore } from "../src/security/protection-store.js";

const zeroUsage = {
  discoveryWorkflows: 0,
  llmRequests: 0,
  llmInputTokens: 0,
  llmOutputTokens: 0,
  zhihuSearchRequests: 0
};

describe("shared protection contract", () => {
  it("checks all rate dimensions as one decision", async () => {
    const store = new InMemoryProtectionStore();
    const rules = [
      { key: "ip:a:endpoint", limit: 1, windowMs: 60_000 },
      { key: "user:a:endpoint", limit: 2, windowMs: 60_000 }
    ];
    expect((await store.consumeRateLimits(rules, 1_000)).allowed).toBe(true);
    expect((await store.consumeRateLimits(rules, 1_001)).allowed).toBe(false);
  });

  it("atomically reserves daily budgets and concurrency and releases unused capacity", async () => {
    const store = new InMemoryProtectionStore();
    const first = await store.reserve({
      reservationId: "r1",
      leaseMs: 60_000,
      nowMs: 1_000,
      budgetItems: [{ key: "2026-01-01:user:a:llm_request", amount: 3, limit: 3 }],
      concurrency: [{ key: "user:a", limit: 1 }]
    });
    expect(first.allowed).toBe(true);

    const concurrent = await store.reserve({
      reservationId: "r2",
      leaseMs: 60_000,
      nowMs: 1_001,
      budgetItems: [],
      concurrency: [{ key: "user:a", limit: 1 }]
    });
    expect(concurrent).toEqual({ allowed: false, reasonCode: "CONCURRENCY_LIMITED" });

    if (!first.allowed) throw new Error("Expected reservation");
    await store.settle(first.reservation, { ...zeroUsage, llmRequests: 1 }, false);

    const afterRefund = await store.reserve({
      reservationId: "r3",
      leaseMs: 60_000,
      nowMs: 1_002,
      budgetItems: [{ key: "2026-01-01:user:a:llm_request", amount: 2, limit: 3 }],
      concurrency: [{ key: "user:a", limit: 1 }]
    });
    expect(afterRefund.allowed).toBe(true);
  });

  it("keeps the full reservation after an uncertain upstream failure", async () => {
    const store = new InMemoryProtectionStore();
    const first = await store.reserve({
      reservationId: "r1",
      leaseMs: 60_000,
      budgetItems: [{ key: "2026-01-01:global:all:llm_request", amount: 3, limit: 3 }],
      concurrency: []
    });
    if (!first.allowed) throw new Error("Expected reservation");
    await store.settle(first.reservation, zeroUsage, true);

    const second = await store.reserve({
      reservationId: "r2",
      leaseMs: 60_000,
      budgetItems: [{ key: "2026-01-01:global:all:llm_request", amount: 1, limit: 3 }],
      concurrency: []
    });
    expect(second).toEqual({ allowed: false, reasonCode: "GLOBAL_BUDGET_EXCEEDED" });
  });

  it("uses a persistent kill switch", async () => {
    const store = new InMemoryProtectionStore();
    await store.setLlmEnabled(false);
    expect(await store.getLlmEnabled()).toBe(false);
    expect(
      await store.reserve({ reservationId: "r1", leaseMs: 60_000, budgetItems: [], concurrency: [] })
    ).toEqual({ allowed: false, reasonCode: "LLM_DISABLED" });
  });
});
