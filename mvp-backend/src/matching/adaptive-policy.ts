export const ADAPTIVE_MATCH_POLICY_VERSION = "adaptive-private-pool-v1";

export const ADAPTIVE_MATCH_THRESHOLDS = {
  scarceMaxExclusive: 25,
  growingMaxExclusive: 200
} as const;

export type AdaptiveMatchTier = "scarce" | "growing" | "mature";
export type PrivateRelationThreshold = "indirect_supported" | "balanced" | "strict";

export interface AdaptiveMatchPolicy {
  policyVersion: typeof ADAPTIVE_MATCH_POLICY_VERSION;
  tier: AdaptiveMatchTier;
  appliesTo: "authorized_private";
  eligiblePrivatePoolSize: number;
  retrieval: {
    breadth: "broad" | "expanded" | "focused";
    searchLimit: number;
    analysisLimit: number;
  };
  relationship: {
    privateCandidateThreshold: PrivateRelationThreshold;
    publicCandidateThreshold: "strict";
  };
  evidenceFloor: {
    minimumUserQuotes: 1;
    minimumCandidateQuotes: 1;
    quotesMustBeVerbatim: true;
    sourceAndPermissionMustPass: true;
    allowNoMatch: true;
  };
}

/**
 * Converts the effective, authorized private pool size into a trusted matching
 * policy. The function is deterministic so the model cannot choose how much to
 * relax the relationship threshold for a request.
 *
 * "Effective" means that authorization, recency, safety and author de-duplication
 * have already been applied by the CandidateSource implementation.
 */
export function deriveAdaptiveMatchPolicy(eligiblePrivatePoolSize: number): AdaptiveMatchPolicy {
  if (!Number.isSafeInteger(eligiblePrivatePoolSize) || eligiblePrivatePoolSize < 0) {
    throw new RangeError("eligiblePrivatePoolSize must be a non-negative safe integer");
  }

  if (eligiblePrivatePoolSize < ADAPTIVE_MATCH_THRESHOLDS.scarceMaxExclusive) {
    return makePolicy(eligiblePrivatePoolSize, "scarce", "broad", 12, 8, "indirect_supported");
  }

  if (eligiblePrivatePoolSize < ADAPTIVE_MATCH_THRESHOLDS.growingMaxExclusive) {
    return makePolicy(eligiblePrivatePoolSize, "growing", "expanded", 10, 7, "balanced");
  }

  return makePolicy(eligiblePrivatePoolSize, "mature", "focused", 8, 6, "strict");
}

function makePolicy(
  eligiblePrivatePoolSize: number,
  tier: AdaptiveMatchTier,
  breadth: AdaptiveMatchPolicy["retrieval"]["breadth"],
  searchLimit: number,
  analysisLimit: number,
  privateCandidateThreshold: PrivateRelationThreshold
): AdaptiveMatchPolicy {
  return {
    policyVersion: ADAPTIVE_MATCH_POLICY_VERSION,
    tier,
    appliesTo: "authorized_private",
    eligiblePrivatePoolSize,
    retrieval: { breadth, searchLimit, analysisLimit },
    relationship: {
      privateCandidateThreshold,
      publicCandidateThreshold: "strict"
    },
    evidenceFloor: {
      minimumUserQuotes: 1,
      minimumCandidateQuotes: 1,
      quotesMustBeVerbatim: true,
      sourceAndPermissionMustPass: true,
      allowNoMatch: true
    }
  };
}
