import type { CandidateExpression } from "../contracts/schemas.js";
import { filterDisplayableCandidates } from "../guards/candidates.js";
import { filterInjectionCandidates } from "../security/prompt-injection.js";

export interface CandidateSearchInput {
  directions: string[];
  limit: number;
  breadth: "broad" | "expanded" | "focused";
}

export type CandidateBatchSource = "authorized_private" | "public_inventory" | "public_search" | "static";
export interface CandidateBatch {
  source: CandidateBatchSource;
  candidates: CandidateExpression[];
  reasonCode?: string;
}

export class CandidateSourceError extends Error {
  constructor(public readonly code: string, public readonly source: CandidateBatchSource) { super(code); }
}

export interface CandidateSource {
  /** Lazy batches: requesting the next batch means the previous one had no supported match. */
  searchBatches?(input: CandidateSearchInput, signal: AbortSignal): AsyncIterable<CandidateBatch>;
  /** Returns the effective authorized-private pool size, not registration count. */
  getEligiblePrivatePoolSize(signal: AbortSignal): Promise<number>;
  search(input: CandidateSearchInput, signal: AbortSignal): Promise<CandidateExpression[]>;
}

export class StaticCandidateSource implements CandidateSource {
  constructor(
    private readonly candidates: CandidateExpression[],
    private readonly options: { eligiblePrivatePoolSize?: number; now?: () => number } = {}
  ) {
    if (
      options.eligiblePrivatePoolSize !== undefined &&
      (!Number.isSafeInteger(options.eligiblePrivatePoolSize) || options.eligiblePrivatePoolSize < 0)
    ) {
      throw new RangeError("eligiblePrivatePoolSize must be a non-negative safe integer");
    }
  }

  async getEligiblePrivatePoolSize(signal: AbortSignal): Promise<number> {
    if (signal.aborted) throw new Error("Candidate pool count aborted");
    if (this.options.eligiblePrivatePoolSize !== undefined) return this.options.eligiblePrivatePoolSize;

    const authorizedPrivate = this.candidates.filter(
      (candidate) => candidate.source.sourceType === "authorized_private"
    );
    const displayable = filterDisplayableCandidates(
      authorizedPrivate,
      this.options.now?.() ?? Date.now()
    );
    return filterInjectionCandidates(displayable).accepted.length;
  }

  async search(input: CandidateSearchInput, signal: AbortSignal): Promise<CandidateExpression[]> {
    if (signal.aborted) throw new Error("Candidate search aborted");
    return this.candidates.slice(0, input.limit);
  }
}
