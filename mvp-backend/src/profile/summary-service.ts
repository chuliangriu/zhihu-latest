import { randomUUID } from "node:crypto";
import { ProfileDataError } from "./zhihu-footprints.js";
import { PROFILE_FOOTPRINT_LIMIT_PER_KIND, PROFILE_FOOTPRINT_LOOKBACK_YEARS } from "./footprint-policy.js";
import { LlmProviderError, type LlmProvider } from "../llm/provider.js";
import type { PipelineTrace } from "../pipeline/discovery-pipeline.js";
import { containsForbiddenModelArtifact, scanConversationForPromptInjection } from "../security/prompt-injection.js";
import { PROFILE_SUMMARY_SYSTEM_PROMPT } from "../prompts/profile-summary.js";
import { profileModelSchema, type FootprintSource, type ProfileSummary } from "./contracts.js";

export class ProfileSummaryService {
  constructor(private readonly source: FootprintSource, private readonly createLlm: () => LlmProvider) {}
  async generate(userId: string) { return this.run(userId, false); }
  async inspect(userId: string) { return this.run(userId, true); }
  private async run(userId: string, inspectOnly: boolean) {
    const trace: PipelineTrace = { requestId: randomUUID(), matchPolicy: null, stages: [], rejectedMatches: [] };
    const result: ProfileSummary = { requestId: trace.requestId,
      diagnostics: { usableCount: 0, modelCalled: false, stage: "reading" }, status: "needs_input", reasonCode: "insufficient_footprints", profile: null,
      coverage: { creations: 0, collections: 0, browsingAvailable: false, likedHistoryAvailable: false } };
    let userDataRequests = 0;
    const started = Date.now();
    const signal = AbortSignal.timeout(50000);
    try {
      const raw = await this.source.load(userId, signal, () => { userDataRequests++; });
      const footprints = raw.filter(f => scanConversationForPromptInjection({ messages: [{ id: f.id, role: "user", content: `${f.title}\n${f.summary}` }] }).length === 0).slice(0, PROFILE_FOOTPRINT_LIMIT_PER_KIND * 2);
      result.sources = { creation: "read", collection: "read" };
      result.diagnostics.stage = "filtering";
      result.diagnostics.usableCount = footprints.length;
      result.coverage.creations = footprints.filter(f => f.kind === "creation").length;
      result.coverage.collections = footprints.filter(f => f.kind === "collection").length;
      if (inspectOnly) {
        if (footprints.length >= 2) result.reasonCode = "profile_footprints_available";
        return { result, trace, userDataRequests };
      }
      if (footprints.length < 2) return { result, trace, userDataRequests };
      const llm = this.createLlm();
      result.diagnostics.stage = "model";
      const payload = { footprints, availableSources: ["creation", "collection"], lookbackYears: PROFILE_FOOTPRINT_LOOKBACK_YEARS };
      const complete = async (correction: boolean) => {
        signal.throwIfAborted();
        const stage: PipelineTrace["stages"][number] = { name: "profile_summary", durationMs: 0 };
        trace.stages.push(stage);
        const modelStarted = Date.now();
        result.diagnostics.modelCalled = true;
        try {
          const completion = await llm.completeJson({ task: "profile_summary",
            systemPrompt: correction ? `${PROFILE_SUMMARY_SYSTEM_PROMPT}\n\n格式纠正：上次输出未通过 JSON Schema 校验。请依据以下字段错误重新输出，遵守全部证据规则，不补造身份、引用或事实。字段错误：${JSON.stringify(result.diagnostics.schemaIssues ?? [])}` : PROFILE_SUMMARY_SYSTEM_PROMPT,
            payload,
            schema: profileModelSchema, signal });
          stage.usage = completion.usage;
          return completion;
        } catch (error) {
          stage.usage = error instanceof LlmProviderError && error.details ? { ...error.details.usage }
            : { inputTokens: null, outputTokens: null, requests: 1, retries: 0 };
          throw error;
        } finally { stage.durationMs = Date.now() - modelStarted; }
      };
      let completion: Awaited<ReturnType<typeof complete>>;
      try { completion = await complete(false); }
      catch (error) {
        if (!(error instanceof LlmProviderError) || error.code !== "LLM_SCHEMA_INVALID" || signal.aborted) throw error;
        if (error.details) result.diagnostics.schemaIssues = error.details.schemaIssues;
        result.diagnostics.schemaCorrectionAttempted = true;
        completion = await complete(true);
      }
      const output = profileModelSchema.parse(completion.data);
      result.diagnostics.stage = "evidence";
      if (output.insufficientEvidence) {
        result.reasonCode = "profile_insufficient_evidence";
        return { result, trace, userDataRequests };
      }
      if (output.background.length !== 2 || !output.recentFocus) {
        result.status = "unavailable"; result.reasonCode = "profile_output_incomplete";
        return { result, trace, userDataRequests };
      }
      const claims = [...output.background, output.recentFocus];
      const invalid = claims.some(c => /[<>\n\r]|【|】/.test(c.text) || containsForbiddenModelArtifact([c.text]) || c.citations.some(ref => {
        const evidence = footprints.find(f => f.id === ref.refId);
        if (!evidence) return true;
        // Self-report citations must be from the author's own summary, never a topic title or a collection.
        return c.kind === "self_report" ? evidence.kind !== "creation" || !evidence.summary.includes(ref.quote)
          : !evidence.title.includes(ref.quote) && !evidence.summary.includes(ref.quote);
      }));
      if (invalid) { result.reasonCode = "profile_evidence_rejected"; return { result, trace, userDataRequests }; }
      const impression = output.background.map(c => c.text);
      const recentFocus = output.recentFocus.text;
      const unknown = [...new Set(output.unknown)].join("、") || "无";
      result.profile = { role: "你的近期背景", impression, recentFocus, requiresConfirmation: true,
        markdown: `【有限背景】\n${impression.join("\n\n")}\n\n【最近最明显的一条线】\n${recentFocus}\n\n【无法确认】\n${unknown}` };
      result.diagnostics.stage = "complete";
      result.status = "ready"; result.reasonCode = "profile_summary_generated";
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : "PROFILE_UNAVAILABLE";
      result.status = "unavailable"; result.reasonCode = code;
      if (error instanceof LlmProviderError && error.details) result.diagnostics.schemaIssues = error.details.schemaIssues;
      if (error instanceof ProfileDataError) {
        const accepted = (error.progress?.footprints ?? []).filter(f => scanConversationForPromptInjection({ messages: [{ id: f.id, role: "user", content: `${f.title}\n${f.summary}` }] }).length === 0);
        result.diagnostics.usableCount = accepted.length;
        result.coverage.creations = accepted.filter(f => f.kind === "creation").length;
        result.coverage.collections = accepted.filter(f => f.kind === "collection").length;
        if (error.progress) result.sources = { ...error.progress.sources };
        if (error.retryAfterSeconds) result.retryAfterSeconds = error.retryAfterSeconds;
      }
      if (inspectOnly && error instanceof ProfileDataError && error.connection) {
        result.connection = { ...error.connection };
        if (["OAUTH_REAUTH_REQUIRED","ZHIHU_ACCESS_SECRET_REJECTED"].includes(code) && ["creation", "collection"].includes(error.connection.stage) && this.source.checkAccessSecret) {
          const checkStarted = Date.now();
          try { result.connection.accessSecret = await this.source.checkAccessSecret(signal); }
          catch { result.connection.accessSecret = { status: "unavailable" }; }
          trace.stages.push({ name: "zhihu_credential_check", durationMs: Date.now()-checkStarted, zhihuSearchRequests: 1 });
        }
      }
      trace.stages.push({ name: "profile_error", durationMs: Date.now()-started, note: code });
    }
    return { result, trace, userDataRequests };
  }
}
