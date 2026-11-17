import { describe, expect, it } from "vitest";
import {
  ADAPTIVE_MATCH_THRESHOLDS,
  deriveAdaptiveMatchPolicy
} from "../src/matching/adaptive-policy.js";

describe("adaptive private-pool match policy", () => {
  it.each([
    [0, "scarce", "indirect_supported", 12, 8],
    [ADAPTIVE_MATCH_THRESHOLDS.scarceMaxExclusive - 1, "scarce", "indirect_supported", 12, 8],
    [ADAPTIVE_MATCH_THRESHOLDS.scarceMaxExclusive, "growing", "balanced", 10, 7],
    [ADAPTIVE_MATCH_THRESHOLDS.growingMaxExclusive - 1, "growing", "balanced", 10, 7],
    [ADAPTIVE_MATCH_THRESHOLDS.growingMaxExclusive, "mature", "strict", 8, 6]
  ] as const)("maps pool size %i to %s", (poolSize, tier, threshold, searchLimit, analysisLimit) => {
    const policy = deriveAdaptiveMatchPolicy(poolSize);
    expect(policy.tier).toBe(tier);
    expect(policy.relationship.privateCandidateThreshold).toBe(threshold);
    expect(policy.retrieval).toMatchObject({ searchLimit, analysisLimit });
  });

  it("gets monotonically stricter as the pool grows", () => {
    const rank = { indirect_supported: 0, balanced: 1, strict: 2 } as const;
    const sizes = [0, 1, 24, 25, 80, 199, 200, 10_000];
    const strictness = sizes.map(
      (size) => rank[deriveAdaptiveMatchPolicy(size).relationship.privateCandidateThreshold]
    );

    expect(strictness).toEqual([...strictness].sort((left, right) => left - right));
  });

  it("never changes the evidence floor or the public-candidate threshold", () => {
    for (const size of [0, 25, 200, 10_000]) {
      const policy = deriveAdaptiveMatchPolicy(size);
      expect(policy.relationship.publicCandidateThreshold).toBe("strict");
      expect(policy.evidenceFloor).toEqual({
        minimumUserQuotes: 1,
        minimumCandidateQuotes: 1,
        quotesMustBeVerbatim: true,
        sourceAndPermissionMustPass: true,
        allowNoMatch: true
      });
    }
  });

  it.each([-1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1])(
    "rejects an invalid pool size: %s",
    (poolSize) => {
      expect(() => deriveAdaptiveMatchPolicy(poolSize)).toThrow(RangeError);
    }
  );
});
