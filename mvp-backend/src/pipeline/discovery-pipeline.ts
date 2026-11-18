import { randomUUID } from "node:crypto";
import {
  PIPELINE_VERSION,
  PROMPT_VERSION,
  candidateAnalysisOutputSchema,
  discoveryIntentOutputSchema,
  discoveryResultSchema,
  presentationCopyOutputSchema,
  type ConversationContext,
  type DiscoveryResult,
  type EvaluateRequest,
  type MatchResult,
  type PresentationCopyOutput
} from "../contracts/schemas.js";
import { filterDisplayableCandidates } from "../guards/candidates.js";
import { precheckConversation } from "../guards/conversation.js";
import { validateMatchDrafts } from "../guards/matches.js";
import type { LlmProvider, LlmUsage } from "../llm/provider.js";
import {
  ADAPTIVE_MATCH_POLICY_VERSION,
  deriveAdaptiveMatchPolicy,
  type AdaptiveMatchPolicy
} from "../matching/adaptive-policy.js";
import { CANDIDATE_ANALYSIS_SYSTEM_PROMPT } from "../prompts/candidate-analysis.js";
import { DISCOVERY_INTENT_SYSTEM_PROMPT } from "../prompts/discovery-intent.js";
import { PRESENTATION_COPY_SYSTEM_PROMPT } from "../prompts/presentation-copy.js";
import {
  containsForbiddenModelArtifact,
  filterInjectionCandidates,
  scanConversationForPromptInjection
} from "../security/prompt-injection.js";
import { CandidateSourceError, type CandidateSource, type CandidateBatch } from "../sources/candidate-source.js";

export interface PipelineTrace {
  requestId: string;
  matchPolicy: {
    policyVersion: string;
    eligiblePrivatePoolSize: number;
    tier: AdaptiveMatchPolicy["tier"];
  } | null;
  stages: Array<{
    name: string;
    durationMs: number;
    usage?: LlmUsage;
    zhihuSearchRequests?: number;
    note?: string;
  }>;
  rejectedMatches: Array<{ candidateId: string; reason: string }>;
}

export interface DiscoveryPipelineDependencies {
  llm: LlmProvider;
  candidateSource: CandidateSource;
  timeoutMs: number;
  trustedContext: {
    allowDiscovery: boolean;
    safetyPassed: boolean;
  };
  now?: () => number;
  dataMode?: "fixture" | "routed";
  publicRecentDays?: number;
  allowPublicDemoTime?: boolean;
  onTrace?: (trace: PipelineTrace) => void;
}

export async function runDiscoveryPipeline(
  request: EvaluateRequest & { conversation: ConversationContext },
  dependencies: DiscoveryPipelineDependencies
): Promise<DiscoveryResult> {
  const startedAt = dependencies.now?.() ?? Date.now();
  const requestId = randomUUID();
  const trace: PipelineTrace = { requestId, matchPolicy: null, stages: [], rejectedMatches: [] };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), dependencies.timeoutMs);
  let intent = emptyUnderstanding();
  let candidateCount = 0;
  let matchPolicy: AdaptiveMatchPolicy | null = null;
  let presentationCopy: PresentationCopyOutput | null = null;

  const finish = (
    status: DiscoveryResult["status"],
    reasonCode: string,
    matches: { situationClose: MatchResult | null; structureRelated: MatchResult | null },
    inviteCopy: string | null
  ): DiscoveryResult => {
    const finishedAt = dependencies.now?.() ?? Date.now();
    const result = discoveryResultSchema.parse({
      requestId,
      status,
      shouldInvite: status === "matched" && Boolean(matches.situationClose || matches.structureRelated),
      understanding: {
        explicitConcerns: intent.explicitConcerns,
        uncertainPoints: intent.uncertainPoints
      },
      matches,
      inviteCopy,
      presentationCopy,
      reasonCode,
      dataMode: dependencies.dataMode ?? "fixture",
      modelMode: dependencies.llm.mode,
      meta: {
        pipelineVersion: PIPELINE_VERSION,
        promptVersion: PROMPT_VERSION,
        matchPolicyVersion: ADAPTIVE_MATCH_POLICY_VERSION,
        eligiblePrivatePoolSize: matchPolicy?.eligiblePrivatePoolSize ?? null,
        matchPolicyTier: matchPolicy?.tier ?? null,
        durationMs: Math.max(0, finishedAt - startedAt),
        candidateCount
      }
    });
    dependencies.onTrace?.(trace);
    return result;
  };

  try {
    if (!dependencies.trustedContext.allowDiscovery) {
      return finish("not_eligible", "discovery_permission_missing", emptyMatches(), null);
    }
    if (!dependencies.trustedContext.safetyPassed) {
      return finish("not_eligible", "safety_check_not_passed", emptyMatches(), null);
    }

    const conversationInjection = scanConversationForPromptInjection(request.conversation);
    if (conversationInjection.length > 0) {
      trace.stages.push({
        name: "prompt_injection_guard",
        durationMs: 0,
        note: conversationInjection.map((finding) => finding.code).join(",")
      });
      return finish("not_eligible", "prompt_injection_blocked", emptyMatches(), null);
    }

    const precheck = precheckConversation(request.conversation);
    if (!precheck.eligible) {
      return finish("not_eligible", precheck.reasonCode, emptyMatches(), null);
    }

    const intentStageStart = dependencies.now?.() ?? Date.now();
    const intentCompletion = await dependencies.llm.completeJson({
      task: "discovery_intent",
      systemPrompt: DISCOVERY_INTENT_SYSTEM_PROMPT,
      payload: {
        userMessages: request.conversation.messages
          .filter((message) => message.role === "user")
          .map(({ id, content }) => ({ id, content })),
        answerTurnComplete: true,
        safetyResult: { pass: dependencies.trustedContext.safetyPassed }
      },
      schema: discoveryIntentOutputSchema,
      signal: controller.signal
    });
    intent = intentCompletion.data;
    trace.stages.push({
      name: "discovery_intent",
      durationMs: (dependencies.now?.() ?? Date.now()) - intentStageStart,
      usage: intentCompletion.usage
    });

    if (
      containsForbiddenModelArtifact([
        ...intent.reasonCodes,
        ...intent.explicitConcerns,
        ...intent.uncertainPoints,
        ...intent.searchDirections,
        intent.refusalReason ?? ""
      ])
    ) {
      return finish("unavailable", "model_output_security_rejected", emptyMatches(), null);
    }

    if (!intent.shouldSearch) {
      return finish("not_eligible", intent.refusalReason ? "llm_declined_search" : "no_search_signal", emptyMatches(), null);
    }

    const policyStageStart = dependencies.now?.() ?? Date.now();
    const eligiblePrivatePoolSize = await dependencies.candidateSource.getEligiblePrivatePoolSize(controller.signal);
    matchPolicy = deriveAdaptiveMatchPolicy(eligiblePrivatePoolSize);
    trace.matchPolicy = {
      policyVersion: matchPolicy.policyVersion,
      eligiblePrivatePoolSize,
      tier: matchPolicy.tier
    };
    trace.stages.push({
      name: "adaptive_match_policy",
      durationMs: (dependencies.now?.() ?? Date.now()) - policyStageStart,
      note: `${matchPolicy.tier}; private_pool=${eligiblePrivatePoolSize}; applies_to=authorized_private`
    });

    const searchInput = { directions: intent.searchDirections, limit: matchPolicy.retrieval.searchLimit, breadth: matchPolicy.retrieval.breadth };
    const source = dependencies.candidateSource;
    const batches = source.searchBatches ? source.searchBatches(searchInput,controller.signal) : (async function*(): AsyncIterable<CandidateBatch> {
      yield {source:"static",candidates:await source.search(searchInput,controller.signal)};
    })();
    let noMatchReason = "no_displayable_candidates";
    for await (const batch of batches) {
      controller.signal.throwIfAborted();
      const sourceStageStart = dependencies.now?.() ?? Date.now();
      const rawCandidates = dependencies.dataMode === "routed" ? batch.candidates.filter(c=>c.source.sourceType!=="synthetic_private") : batch.candidates;
      const routed = dependencies.dataMode === "routed";
      const publicDays = routed ? Math.min(dependencies.publicRecentDays ?? 14, 14) : dependencies.publicRecentDays ?? 7;
      const displayableCandidates = filterDisplayableCandidates(rawCandidates, dependencies.now?.() ?? Date.now(), 7, publicDays, routed, dependencies.allowPublicDemoTime);
      const injectionCheck = filterInjectionCandidates(displayableCandidates);
      const candidates = injectionCheck.accepted.slice(0, matchPolicy.retrieval.analysisLimit);
      candidateCount += candidates.length;
      trace.stages.push({
        name: "candidate_source",
        durationMs: (dependencies.now?.() ?? Date.now()) - sourceStageStart,
        note: `${batch.source}; ${rawCandidates.length} received, ${candidates.length} displayable, ${injectionCheck.rejected.length} injection-rejected; ${batch.reasonCode??"completed"}`
      });

      if (candidates.length === 0) {
        trace.stages.push({name:"candidate_source_result",durationMs:0,note:`${batch.source}; no_displayable_candidates`});
        continue;
      }

      const analysisStageStart = dependencies.now?.() ?? Date.now();
      const analysisCompletion = await dependencies.llm.completeJson({
        task: "candidate_analysis",
        systemPrompt: CANDIDATE_ANALYSIS_SYSTEM_PROMPT,
        payload: {
          understanding: intent,
          adaptiveMatchPolicy: matchPolicy,
          userMessages: request.conversation.messages
            .filter((message) => message.role === "user")
            .map(({ id, content }) => ({ id, content })),
          candidates: candidates.map((candidate) => ({
            candidateId: candidate.candidateId,
            domain: candidate.domain,
            text: candidate.text,
            source: {
              sourceId: candidate.source.sourceId,
              sourceType: candidate.source.sourceType,
              contentType: candidate.source.contentType,
              publishedAt: candidate.source.publishedAt,
              timestampKind: candidate.source.timestampKind ?? "published"
            }
          }))
        },
        schema: candidateAnalysisOutputSchema,
        signal: controller.signal
      });
      trace.stages.push({
        name: "candidate_analysis",
        durationMs: (dependencies.now?.() ?? Date.now()) - analysisStageStart,
        usage: analysisCompletion.usage,
        note: batch.source
      });

      if (
        containsForbiddenModelArtifact([
          analysisCompletion.data.inviteCopy ?? "",
          ...analysisCompletion.data.rejectionReasons,
          ...analysisCompletion.data.matches.flatMap((match) => [match.sharedRelation, match.difference])
        ])
      ) {
        return finish("unavailable", "model_output_security_rejected", emptyMatches(), null);
      }

      const validation = validateMatchDrafts(
        analysisCompletion.data.matches,
        request.conversation,
        candidates,
        intent
      );
      trace.rejectedMatches.push(...validation.rejected);

      if (validation.accepted.length === 0) {
        noMatchReason = analysisCompletion.data.matches.length > 0 ? "no_supported_match_after_validation" : "llm_found_no_supported_match";
        trace.stages.push({name:"candidate_source_result",durationMs:0,note:`${batch.source}; ${noMatchReason}`});
        continue;
      }

      const matches = emptyMatches();
      for (const match of validation.accepted) matches[match.path] = match;

      const presentationStageStart = dependencies.now?.() ?? Date.now();
      // Co-generate wording to save a network/model round-trip, but never expose
      // it before the exact same candidate/evidence validation has passed.
      const bundledCopy = analysisCompletion.data.presentationCopy;
      const reusableCopy = bundledCopy && presentationMatchesValidatedCandidates(bundledCopy,validation.accepted) ? bundledCopy : null;
      const presentationCompletion = reusableCopy ? {data:reusableCopy,usage:undefined} : await dependencies.llm.completeJson({
        task: "presentation_copy",
        systemPrompt: PRESENTATION_COPY_SYSTEM_PROMPT,
        payload: {
          templateVersion: "discovery-presentation-v0.4",
          understanding: {
            explicitConcerns: intent.explicitConcerns,
            uncertainPoints: intent.uncertainPoints
          },
          validatedMatches: validation.accepted.map((match) => {
            const candidate = candidates.find((item) => item.candidateId === match.candidateId)!;
            return {
              path: match.path,
              candidateId: match.candidateId,
              sourceType: match.sourceType,
              contentType: match.contentType,
              contactable: match.contactable,
              identityDisclosable: match.identityDisclosable,
              candidateText: candidate.text,
              timestampKind: candidate.source.timestampKind ?? "published",
              interactionFacts: candidate.source.interactionFacts ?? null,
              sharedRelation: match.sharedRelation,
              difference: match.difference,
              evidence: match.evidenceRefs
            };
          })
        },
        schema: presentationCopyOutputSchema,
        signal: controller.signal
      });
      trace.stages.push({
        name: "presentation_copy",
        durationMs: (dependencies.now?.() ?? Date.now()) - presentationStageStart,
        ...(presentationCompletion.usage ? {usage:presentationCompletion.usage} : {note:"co_generated_with_analysis; evidence_validated_before_display"})
      });

      if (!presentationMatchesValidatedCandidates(presentationCompletion.data, validation.accepted)) {
        return finish("unavailable", "presentation_output_misaligned", emptyMatches(), null);
      }
      if (
        containsForbiddenModelArtifact([
          presentationCompletion.data.sharedConcern,
          ...presentationCompletion.data.choices.flatMap((choice) => [choice.bridge, choice.relation])
        ])
      ) {
        return finish("unavailable", "model_output_security_rejected", emptyMatches(), null);
      }
      presentationCopy = presentationCompletion.data;
      trace.stages.push({name:"candidate_source_result",durationMs:0,note:`${batch.source}; supported_match_found`});
      return finish("matched", "supported_match_found", matches, analysisCompletion.data.inviteCopy);
    }
    return finish("no_match", noMatchReason, emptyMatches(), null);
  } catch (error) {
    if (error instanceof CandidateSourceError) trace.stages.push({name:"candidate_source_result",durationMs:0,note:`${error.source}; failed; ${error.code}`});
    trace.stages.push({
      name: "pipeline_error",
      durationMs: Math.max(0, (dependencies.now?.() ?? Date.now()) - startedAt),
      note: errorCode(error, controller.signal.aborted)
    });
    return finish("unavailable", errorCode(error, controller.signal.aborted), emptyMatches(), null);
  } finally {
    clearTimeout(timeout);
  }
}

function presentationMatchesValidatedCandidates(
  copy: PresentationCopyOutput,
  matches: MatchResult[]
): boolean {
  if (copy.choices.length !== matches.length) return false;
  const expected = matches.map((match) => `${match.path}:${match.candidateId}`).sort();
  const actual = copy.choices.map((choice) => `${choice.path}:${choice.candidateId}`).sort();
  return expected.every((value, index) => value === actual[index]);
}

function emptyMatches(): {
  situationClose: MatchResult | null;
  structureRelated: MatchResult | null;
} {
  return { situationClose: null, structureRelated: null };
}

function emptyUnderstanding() {
  return {
    shouldSearch: false,
    reasonCodes: [] as string[],
    primaryDomain: null as string | null,
    explicitConcerns: [] as string[],
    uncertainPoints: [] as string[],
    searchDirections: [] as string[],
    refusalReason: null as string | null
  };
}

function errorCode(error: unknown, aborted: boolean): string {
  if (aborted) return "pipeline_timeout";
  if (error && typeof error === "object" && "code" in error && typeof error.code === "string") {
    return error.code.toLowerCase();
  }
  return "pipeline_failed";
}
