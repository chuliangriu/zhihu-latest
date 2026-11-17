import { randomUUID } from "node:crypto";
import { ProfileDataError } from "./zhihu-footprints.js";
import type { LlmProvider } from "../llm/provider.js";
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
    const result: ProfileSummary = { status: "needs_input", reasonCode: "insufficient_footprints", profile: null,
      coverage: { creations: 0, collections: 0, browsingAvailable: false, likedHistoryAvailable: false } };
    let userDataRequests = 0;
    const started = Date.now();
    const signal = AbortSignal.timeout(25000);
    try {
      const raw = await this.source.load(userId, signal, () => { userDataRequests++; });
      const footprints = raw.filter(f => scanConversationForPromptInjection({ messages: [{ id: f.id, role: "user", content: `${f.title}\n${f.summary}` }] }).length === 0).slice(0,16);
      result.coverage.creations = footprints.filter(f => f.kind === "creation").length;
      result.coverage.collections = footprints.filter(f => f.kind === "collection").length;
      if (inspectOnly) {
        if (footprints.length >= 2) result.reasonCode = "profile_footprints_available";
        return { result, trace, userDataRequests };
      }
      if (footprints.length < 2) return { result, trace, userDataRequests };
      const stage = { name: "profile_summary", durationMs: 0 };
      trace.stages.push(stage);
      const completion = await this.createLlm().completeJson({ task: "profile_summary", systemPrompt: PROFILE_SUMMARY_SYSTEM_PROMPT,
        payload: { footprints, availableSources: ["creation", "collection"], lookbackDays: 90 }, schema: profileModelSchema, signal });
      Object.assign(stage, { durationMs: Date.now()-started, usage: completion.usage });
      const output = profileModelSchema.parse(completion.data);
      if (output.insufficientEvidence || output.background.length !== 2 || !output.recentFocus) return { result, trace, userDataRequests };
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
      result.status = "ready"; result.reasonCode = "profile_summary_generated";
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : "PROFILE_UNAVAILABLE";
      result.status = "unavailable"; result.reasonCode = code;
      if (inspectOnly && error instanceof ProfileDataError && error.connection) result.connection = error.connection;
      trace.stages.push({ name: "profile_error", durationMs: Date.now()-started, note: code });
    }
    return { result, trace, userDataRequests };
  }
}
