import { expect, it } from "vitest";
import { FixtureRepository } from "../src/sources/fixture-repository.js";
import { RoutedCandidateSource } from "../src/sources/routed-source.js";
import { MockLlmProvider } from "../src/llm/mock-provider.js";
import { runDiscoveryPipeline } from "../src/pipeline/discovery-pipeline.js";
import { StaticCandidateSource } from "../src/sources/candidate-source.js";

it.each(["published","inventory_assigned"] as const)("runs all three nodes with real public evidence and %s dates", async timeKind => {
  const kind: "public" | "synthetic_private" = "public";
  const fixture = await new FixtureRepository().load("feedback-across-domains");
  const candidate = structuredClone(fixture.candidates.find(c => kind === "public" ? c.source.sourceType === "public" : c.source.sourceType === "authorized_private")!);
  candidate.source.sourceType = kind;
  candidate.source.url = kind === "public" ? "https://www.zhihu.com/answer/123" : null;
  candidate.permission.contactable = false;
  candidate.source.publishedAt = new Date(Date.now() - (kind === "public" ? 10 : 1) * 86400000).toISOString();
  candidate.source.timestampKind = timeKind;
  candidate.source.verified = kind === "public";
  const outputs = fixture.fixture.mockOutputs;
  const intent = { ...outputs.intent, searchDirections: [candidate.text] };
  const llm = new MockLlmProvider({
    discovery_intent: intent,
    candidate_analysis: { ...outputs.candidateAnalysis!, matches: outputs.candidateAnalysis!.matches.filter(m => m.candidateId === candidate.candidateId) },
    presentation_copy: { ...outputs.presentationCopy!, choices: outputs.presentationCopy!.choices.filter(c => c.candidateId === candidate.candidateId) }
  });
  const source = new RoutedCandidateSource("viewer", { list: async () => [] }, kind === "public" ? [candidate] : [], [], { random: () => 0 });
  const result = await runDiscoveryPipeline({ fixtureSet: "ignored", conversation: fixture.fixture.request.conversation! }, {
    llm, candidateSource: source, timeoutMs: 1000, dataMode: "routed", publicRecentDays: 14,
    trustedContext: { allowDiscovery: true, safetyPassed: true }
  });
  expect(result.status).toBe("matched");
  expect(result.dataMode).toBe("routed");
  expect(llm.calls).toEqual(["discovery_intent", "candidate_analysis", "presentation_copy"]);
  const match = Object.values(result.matches).find(m => m !== null)!;
  expect(match.sourceType).toBe(kind);
  expect(match.contactable).toBe(false);
  expect(result.meta.eligiblePrivatePoolSize).toBe(0);
  expect(match.publishedAt).toBe(candidate.source.publishedAt);
});

it.each(["old", "ambiguous", "missing"])("routed pipeline cannot bypass date policy through another source: %s", async reason => {
  const fixture = await new FixtureRepository().load("feedback-across-domains");
  const candidate = structuredClone(fixture.candidates.find(c => c.source.sourceType === "public")!);
  candidate.source.publishedAt = new Date(Date.now() - (reason === "old" ? 15 : 1) * 86400000).toISOString();
  candidate.source.timestampKind = reason === "ambiguous" ? "edited_or_published" : "published";
  if (reason === "missing") delete candidate.source.timestampKind;
  const llm = new MockLlmProvider({ discovery_intent: { ...fixture.fixture.mockOutputs.intent, shouldSearch: true } });
  const result = await runDiscoveryPipeline({ fixtureSet: "ignored", conversation: fixture.fixture.request.conversation! }, {
    llm, candidateSource: new StaticCandidateSource([candidate]), timeoutMs: 1000, dataMode: "routed", publicRecentDays: Infinity,
    trustedContext: { allowDiscovery: true, safetyPassed: true }
  });
  expect(result.status).toBe("no_match");
  expect(llm.calls).toEqual(["discovery_intent"]);
});
