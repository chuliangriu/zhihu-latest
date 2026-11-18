import { expect, it, vi } from "vitest";
import { FixtureRepository } from "../src/sources/fixture-repository.js";
import { RoutedCandidateSource } from "../src/sources/routed-source.js";
import { StaticCandidateSource } from "../src/sources/candidate-source.js";
import { MockLlmProvider } from "../src/llm/mock-provider.js";
import { runDiscoveryPipeline, type PipelineTrace } from "../src/pipeline/discovery-pipeline.js";
import { LlmProviderError, type CompleteJsonInput, type LlmCompletion, type LlmTask } from "../src/llm/provider.js";
import { ZhihuPublicSearchError } from "../src/sources/zhihu-public-search.js";
import type { CandidateExpression } from "../src/contracts/schemas.js";
import { ProtectionService } from "../src/security/protection-service.js";
import { InMemoryProtectionStore } from "../src/security/protection-store.js";
import { InMemoryMonitoringStore } from "../src/security/monitoring-store.js";
import { loadConfig } from "../src/config.js";

type Outcome = "none" | "invalid" | "match" | "model_failure";
async function harness(outcomes: Outcome[], options: { emptyPrivate?: boolean; emptyInventory?: boolean; liveError?: string; emptyLive?: boolean; syntheticOnly?: boolean } = {}) {
  const fixture = await new FixtureRepository().load("feedback-across-domains");
  const base=fixture.candidates.find(c=>c.source.sourceType==="authorized_private")!;
  const template=fixture.fixture.mockOutputs.candidateAnalysis!.matches.find(m=>m.candidateId===base.candidateId)!;
  const copy=fixture.fixture.mockOutputs.presentationCopy!;
  const copyTemplate=copy.choices.find(c=>c.candidateId===base.candidateId)!;
  const make=(type:CandidateExpression["source"]["sourceType"],id:string):CandidateExpression=>({
    ...structuredClone(base),candidateId:id,authorId:`author-${id}`,
    source:{...base.source,sourceId:id,sourceType:type,contentType:type==="public"?"answer":"authorized_expression",
      url:type==="public"?`https://www.zhihu.com/answer/${id==="inventory"?123:456}`:null,
      publishedAt:new Date(Date.now()-86400000).toISOString(),timestampKind:type==="synthetic_private"?"sample_created":"published",verified:type!=="synthetic_private"}
  });
  const privateCard=make("authorized_private","private"),inventory=make("public","inventory"),live=make("public","live");
  const outputs:Partial<Record<LlmTask,unknown>>={discovery_intent:{...fixture.fixture.mockOutputs.intent,searchDirections:[base.text]}};
  const analyzed:string[]=[];
  class SequencedLlm extends MockLlmProvider {
    override async completeJson<T>(input:CompleteJsonInput<T>):Promise<LlmCompletion<T>> {
      if(input.task==="candidate_analysis") {
        const candidate=(input.payload as {candidates:CandidateExpression[]}).candidates[0]!;
        analyzed.push(candidate.candidateId);
        const outcome=outcomes.shift()??"none";
        if(outcome==="model_failure")throw new LlmProviderError("LLM_TIMEOUT_OR_ABORTED","private provider response must not be exposed");
        const draft={...template,path:"situationClose",candidateId:candidate.candidateId,evidence:template.evidence.map(e=>e.side==="candidate"?{...e,refId:candidate.source.sourceId,quote:outcome==="invalid"?"这句话不在候选原文中":e.quote}:e)};
        outputs.candidate_analysis={...fixture.fixture.mockOutputs.candidateAnalysis,matches:outcome==="none"?[]:[draft],presentationCopy:null};
        outputs.presentation_copy={...copy,choices:[{...copyTemplate,path:"situationClose",candidateId:candidate.candidateId}]};
      }
      return super.completeJson(input);
    }
  }
  const llm=new SequencedLlm(outputs);
  const provider={requestCount:0,lastReason:"verified_publication_time",search:vi.fn(async()=>{
    provider.requestCount++;
    if(options.liveError)throw new ZhihuPublicSearchError(options.liveError);
    return options.emptyLive?[]:[live];
  })};
  const source=options.syntheticOnly?new StaticCandidateSource([make("synthetic_private","synthetic")]):new RoutedCandidateSource("viewer",{list:async()=>options.emptyPrivate?[]:[privateCard]},options.emptyInventory?[]:[inventory],[],{publicProvider:provider});
  let trace:PipelineTrace|undefined;
  const result=await runDiscoveryPipeline({fixtureSet:"ordered",conversation:fixture.fixture.request.conversation!}, {
    llm,candidateSource:source,timeoutMs:1000,dataMode:"routed",publicRecentDays:14,
    trustedContext:{allowDiscovery:true,safetyPassed:true},onTrace:value=>{trace=value;}
  });
  return {result,trace:trace!,provider,llm,analyzed};
}

it("stops at a reliable real paper without querying public sources",async()=>{
  const h=await harness(["match"]);
  expect(h.result.status).toBe("matched");expect(h.result.matches.situationClose?.candidateId).toBe("private");
  expect(h.analyzed).toEqual(["private"]);expect(h.provider.search).not.toHaveBeenCalled();
});
it.each(["none","invalid"] as const)("continues after a private %s result and stops at a supported inventory match",async first=>{
  const h=await harness([first,"match"]);
  expect(h.result.status).toBe("matched");expect(h.result.matches.situationClose?.candidateId).toBe("inventory");
  expect(h.analyzed).toEqual(["private","inventory"]);expect(h.provider.search).not.toHaveBeenCalled();
  expect(h.trace.stages.some(s=>s.name==="candidate_source_result"&&s.note?.startsWith("authorized_private;"))).toBe(true);
  expect(h.result.meta.candidateCount).toBe(2);
});
it("analyzes live results after semantic rejection of nonempty private and inventory batches",async()=>{
  const h=await harness(["none","none","match"]);
  expect(h.result.status).toBe("matched");expect(h.result.matches.situationClose?.candidateId).toBe("live");
  expect(h.analyzed).toEqual(["private","inventory","live"]);expect(h.provider.search).toHaveBeenCalledTimes(1);
  expect(h.llm.calls).toEqual(["discovery_intent","candidate_analysis","candidate_analysis","candidate_analysis","presentation_copy"]);
});
it("does not call analysis on empty batches",async()=>{
  const h=await harness(["match"],{emptyPrivate:true,emptyInventory:true});
  expect(h.result.status).toBe("matched");expect(h.analyzed).toEqual(["live"]);
  expect(h.trace.stages.filter(s=>s.name==="candidate_source_result"&&s.note?.includes("no_displayable_candidates"))).toHaveLength(2);
});
it("returns no_match only after all three successful sources have no supported relationship",async()=>{
  const h=await harness(["none","invalid","none"]);
  expect(h.result.status).toBe("no_match");expect(h.result.shouldInvite).toBe(false);
  expect(h.result.matches).toEqual({situationClose:null,structureRelated:null});expect(h.result.presentationCopy).toBeNull();
  expect(h.analyzed).toEqual(["private","inventory","live"]);expect(h.llm.calls).not.toContain("presentation_copy");
});
it.each(["ZHIHU_RATE_LIMITED","ZHIHU_QUOTA_EXCEEDED","ZHIHU_AUTH_FAILED"])("keeps live %s distinct from no_match, never retries",async code=>{
  const h=await harness(["none","none"],{liveError:code});
  expect(h.result.status).toBe("unavailable");expect(h.result.reasonCode).toBe(code.toLowerCase());
  expect(h.provider.search).toHaveBeenCalledTimes(1);
  expect(h.trace.stages).toContainEqual({name:"candidate_source_result",durationMs:0,note:`public_search; failed; ${code}`});
});
it("does not disguise a model failure as no_match or fan out to another source",async()=>{
  const h=await harness(["model_failure"]);
  expect(h.result.status).toBe("unavailable");expect(h.result.reasonCode).toBe("llm_timeout_or_aborted");
  expect(h.provider.search).not.toHaveBeenCalled();expect(JSON.stringify(h.result)).not.toContain("private provider response");
});
it("rejects synthetic candidates even through a different CandidateSource in routed mode",async()=>{
  const h=await harness([],{syntheticOnly:true});
  expect(h.result.status).toBe("no_match");expect(h.analyzed).toEqual([]);expect(h.llm.calls).toEqual(["discovery_intent"]);
});
it("reserves all five routed model stages plus the shared retry budget",async()=>{
  const config={...loadConfig({NODE_ENV:"test"}),candidateMode:"routed" as const};
  const store=new InMemoryProtectionStore(),reserve=vi.spyOn(store,"reserve");
  const protection=new ProtectionService(config,store,new InMemoryMonitoringStore());
  const principal={userId:"owner",sessionId:"session",role:"user" as const,status:"active" as const};
  const begin=await protection.beginDiscovery({principal,userIdHash:"user-hash",sessionIdHash:"session-hash",ipHash:"ip-hash",idempotencyKey:"ordered-budget-key-001"});
  expect(begin.allowed).toBe(true);
  const budgets=reserve.mock.calls[0]![0].budgetItems;
  expect(budgets.find(b=>b.key.endsWith(":user:user-hash:llm_request"))?.amount).toBe(5+config.llm.maxRetries);
});
