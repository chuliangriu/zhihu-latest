import type {
  CandidateExpression,
  ConversationContext,
  DiscoveryIntentOutput,
  MatchDraft,
  MatchResult
} from "../contracts/schemas.js";

const CERTAINTY_PHRASES = ["最适合", "最佳匹配", "命中注定", "一定会理解", "保证会", "肯定会回应"];

export interface MatchValidationResult {
  accepted: MatchResult[];
  rejected: Array<{ candidateId: string; reason: string }>;
}

export function validateMatchDrafts(
  drafts: MatchDraft[],
  conversation: ConversationContext,
  candidates: CandidateExpression[],
  intent: DiscoveryIntentOutput
): MatchValidationResult {
  const accepted: MatchResult[] = [];
  const rejected: Array<{ candidateId: string; reason: string }> = [];
  const userMessages = new Map(
    conversation.messages.filter((message) => message.role === "user").map((message) => [message.id, message])
  );
  const candidatesById = new Map(candidates.map((candidate) => [candidate.candidateId, candidate]));
  const usedPaths = new Set<string>();
  const usedCandidates = new Set<string>();

  for (const draft of drafts) {
    const candidate = candidatesById.get(draft.candidateId);
    const reject = (reason: string) => rejected.push({ candidateId: draft.candidateId, reason });

    if (!candidate) {
      reject("candidate_not_in_server_source");
      continue;
    }
    if (usedPaths.has(draft.path) || usedCandidates.has(draft.candidateId)) {
      reject("duplicate_path_or_candidate");
      continue;
    }
    if (draft.path === "structureRelated" && intent.primaryDomain === candidate.domain) {
      reject("structure_related_requires_surface_difference");
      continue;
    }
    if (CERTAINTY_PHRASES.some((phrase) => `${draft.sharedRelation}${draft.difference}`.includes(phrase))) {
      reject("certainty_language_forbidden");
      continue;
    }
    if (
      !candidate.permission.identityDisclosable &&
      candidate.authorDisplayName.length >= 2 &&
      `${draft.sharedRelation}${draft.difference}`.includes(candidate.authorDisplayName)
    ) {
      reject("identity_disclosure_forbidden");
      continue;
    }

    let hasUserEvidence = false;
    let hasCandidateEvidence = false;
    let evidenceValid = true;

    for (const citation of draft.evidence) {
      if (citation.side === "user") {
        const message = userMessages.get(citation.refId);
        if (!message || !containsQuote(message.content, citation.quote)) {
          evidenceValid = false;
          break;
        }
        hasUserEvidence = true;
      } else {
        if (citation.refId !== candidate.source.sourceId || !containsQuote(candidate.text, citation.quote)) {
          evidenceValid = false;
          break;
        }
        hasCandidateEvidence = true;
      }
    }

    if (!evidenceValid || !hasUserEvidence || !hasCandidateEvidence) {
      reject("evidence_not_grounded_on_both_sides");
      continue;
    }

    accepted.push({
      path: draft.path,
      candidateId: draft.candidateId,
      sharedRelation: draft.sharedRelation,
      difference: draft.difference,
      authorDisplayName: candidate.source.sourceType === "synthetic_private" ? `${candidate.authorDisplayName} · 非真人` : candidate.permission.identityDisclosable ? candidate.authorDisplayName : "匿名用户",
      profileBackground: candidate.source.sourceType === "public" ? [] : candidate.profileBackground ?? [],
      recentFocus: candidate.source.sourceType === "public" ? null : candidate.recentFocus ?? null,
      sourceType: candidate.source.sourceType,
      contentType: candidate.source.contentType,
      sourceUrl: candidate.source.url,
      authorProfileUrl: candidate.permission.identityDisclosable ? candidate.authorProfileUrl ?? null : null,
      publishedAt: candidate.source.publishedAt,
      ...(candidate.source.timestampKind ? { timestampKind: candidate.source.timestampKind } : {}),
      ...(candidate.source.interactionFacts ? { interactionFacts: candidate.source.interactionFacts } : {}),
      contactable: candidate.source.sourceType === "synthetic_private" ? false : candidate.permission.contactable,
      identityDisclosable: candidate.permission.identityDisclosable,
      evidenceRefs: draft.evidence
    });
    usedPaths.add(draft.path);
    usedCandidates.add(draft.candidateId);
  }

  return { accepted, rejected };
}

function containsQuote(source: string, quote: string): boolean {
  return normalize(source).includes(normalize(quote));
}

function normalize(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
