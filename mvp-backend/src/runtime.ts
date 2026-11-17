import type { AppConfig } from "./config.js";
import type { EvaluateRequest, DiscoveryResult } from "./contracts/schemas.js";
import { MockLlmProvider } from "./llm/mock-provider.js";
import { OpenAiCompatibleProvider } from "./llm/openai-compatible-provider.js";
import type { LlmProvider } from "./llm/provider.js";
import { runDiscoveryPipeline, type PipelineTrace } from "./pipeline/discovery-pipeline.js";
import { StaticCandidateSource } from "./sources/candidate-source.js";
import { FixtureRepository } from "./sources/fixture-repository.js";
import { loadSeedCandidates, RoutedCandidateSource } from "./sources/routed-source.js";
import { SupabaseAdapter } from "./sources/supabase-adapter.js";
import type { AuthenticatedPrincipal } from "./security/types.js";
import { ZhihuPublicSearchProvider, ZhihuCliPublicSearchProvider } from "./sources/zhihu-public-search.js";

export class DiscoveryRuntime {
  constructor(
    private readonly config: AppConfig,
    private readonly fixtures = new FixtureRepository(),
    private readonly traceSink: (trace: PipelineTrace) => void = defaultTraceSink
  ) {}

  async evaluate(request: EvaluateRequest): Promise<DiscoveryResult> {
    return (await this.evaluateDetailed(request)).result;
  }

  async evaluateDetailed(request: EvaluateRequest, principal?: AuthenticatedPrincipal): Promise<{ result: DiscoveryResult; trace: PipelineTrace }> {
    if (this.config.candidateMode === "routed") return this.evaluateRouted(request, principal);
    const materialized = await this.fixtures.load(request.fixtureSet);
    const conversation = request.conversation ?? materialized.fixture.request.conversation;
    if (!conversation) throw new Error("Fixture does not contain a conversation");

    const llm = this.createProvider(materialized.fixture.mockOutputs);
    let capturedTrace: PipelineTrace | undefined;
    const result = await runDiscoveryPipeline(
      { ...request, conversation },
      {
        llm,
        candidateSource: new StaticCandidateSource(materialized.candidates),
        timeoutMs: this.config.pipelineTimeoutMs,
        trustedContext: materialized.fixture.trustedContext,
        onTrace: (trace) => {
          capturedTrace = trace;
          this.traceSink(trace);
        }
      }
    );
    if (!capturedTrace) throw new Error("Pipeline completed without a trace");
    return { result, trace: capturedTrace };
  }

  private async evaluateRouted(request: EvaluateRequest, principal?: AuthenticatedPrincipal) {
    if (!principal || !request.conversation) throw new Error("Routed discovery requires trusted identity and conversation");
    const seeds = await loadSeedCandidates(Date.now, this.config.publicDemoTimeEnabled);
    const source = new RoutedCandidateSource(principal.userId,
      new SupabaseAdapter(this.config.supabase.url!, this.config.supabase.serviceKey!),
      seeds.publicCandidates, seeds.synthetic, { publicProbability: this.config.publicSourceProbability, allowPublicDemoTime:this.config.publicDemoTimeEnabled,
        ...(this.config.publicSearchEnabled?{publicProvider:this.config.publicSearchTransport==="local_cli"
          ? new ZhihuCliPublicSearchProvider(this.config.zhihuCliPath!,Date.now,this.config.publicDemoTimeEnabled)
          : new ZhihuPublicSearchProvider(this.config.profile.accessSecret!,fetch,Date.now,this.config.publicDemoTimeEnabled)}:{}) });
    let trace: PipelineTrace | undefined;
    const result = await runDiscoveryPipeline({ ...request, conversation: request.conversation }, {
      llm: new OpenAiCompatibleProvider(this.config.llm), candidateSource: source,
      timeoutMs: this.config.pipelineTimeoutMs, dataMode: "routed", publicRecentDays: 14,
      allowPublicDemoTime:this.config.publicDemoTimeEnabled,
      trustedContext: { allowDiscovery: true, safetyPassed: true },
      onTrace: value => {
        value.stages.push({ name: "candidate_route", durationMs: 0, note: source.decision ?? "not_searched" });
        if (source.publicWindowDays) value.stages.push({ name: "public_recency", durationMs: 0, note: `eligible_within_${source.publicWindowDays}_days;demo_time_enabled=${this.config.publicDemoTimeEnabled}` });
        if (source.publicOrigin) value.stages.push({name:"public_origin",durationMs:0,note:source.publicOrigin});
        if(source.zhihuSearchRequests)value.stages.push({name:"zhihu_public_search",durationMs:0,zhihuSearchRequests:source.zhihuSearchRequests,note:source.publicSearchReason??"completed"});
        trace = value;
      }
    });
    if (!trace) throw new Error("Missing pipeline trace");
    if (result.status === "matched") {
      const ids = Object.values(result.matches).filter(m => m !== null).map(m => m.candidateId);
      if (!await source.revalidate(ids, AbortSignal.timeout(5000))) {
        result.status = "no_match"; result.shouldInvite = false;
        result.matches = { situationClose: null, structureRelated: null };
        result.presentationCopy = null; result.inviteCopy = null; result.reasonCode = "candidate_permission_changed";
        trace.stages.push({ name: "candidate_revalidation", durationMs: 0, note: "permission_or_content_changed" });
      }
    }
    this.traceSink(trace);
    return { result, trace };
  }

  private createProvider(outputs: {
    intent: unknown;
    candidateAnalysis?: unknown;
    presentationCopy?: unknown;
  }): LlmProvider {
    if (this.config.llm.mode === "live") return new OpenAiCompatibleProvider(this.config.llm);
    return new MockLlmProvider({
      discovery_intent: outputs.intent,
      candidate_analysis: outputs.candidateAnalysis,
      presentation_copy: outputs.presentationCopy
    });
  }
}

function defaultTraceSink(trace: PipelineTrace): void {
  const summary = {
    requestId: trace.requestId,
    matchPolicy: trace.matchPolicy,
    stages: trace.stages.map(({ name, durationMs, usage, note }) => ({ name, durationMs, usage, note })),
    rejectedMatches: trace.rejectedMatches
  };
  console.info(JSON.stringify(summary));
}
