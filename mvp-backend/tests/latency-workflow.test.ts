import {it,expect} from 'vitest';
import {ChatService} from '../src/chat/service.js';
import {InMemoryWorkflowStore} from '../src/workflow/store.js';
import {WorkflowMockProvider} from '../src/llm/workflow-mock-provider.js';
import {MockLlmProvider} from '../src/llm/mock-provider.js';
import {FixtureRepository} from '../src/sources/fixture-repository.js';
import {StaticCandidateSource} from '../src/sources/candidate-source.js';
import {runDiscoveryPipeline} from '../src/pipeline/discovery-pipeline.js';
import type {LlmProvider,CompleteJsonInput} from '../src/llm/provider.js';

it('starts topic classification beside the reply and signals answer completion without waiting for classification',async()=>{
  let topicStarted=false,release!:()=>void,answerEnded!:()=>void;
  const gate=new Promise<void>(r=>{release=r;});const ended=new Promise<void>(r=>{answerEnded=r;});
  const mock=new WorkflowMockProvider();
  const provider:LlmProvider={mode:'mock',streamText:async input=>{expect(topicStarted).toBe(true);return mock.streamText(input);},
    completeJson:async<T>(input:CompleteJsonInput<T>)=>{topicStarted=true;await gate;return mock.completeJson(input);}};
  const result=new ChatService(new InMemoryWorkflowStore(),()=>provider).reply({ownerId:'test-user',conversationId:null,
    message:'我在写故事，可一直没有读者。',signal:new AbortController().signal,onChunk:()=>{},onAnswerComplete:answerEnded});
  await ended;release();expect((await result).result.discovery.eligible).toBe(true);
});

it('uses bundled copy only after evidence validation and saves the presentation round-trip',async()=>{
  const fixture=await new FixtureRepository().load('feedback-across-domains');const outputs=fixture.fixture.mockOutputs;
  const llm=new MockLlmProvider({discovery_intent:outputs.intent,candidate_analysis:{...outputs.candidateAnalysis!,presentationCopy:outputs.presentationCopy}});
  const result=await runDiscoveryPipeline({fixtureSet:fixture.fixture.id,conversation:fixture.fixture.request.conversation!},{llm,candidateSource:new StaticCandidateSource(fixture.candidates),timeoutMs:1000,trustedContext:fixture.fixture.trustedContext});
  expect(result.status).toBe('matched');expect(llm.calls).toEqual(['discovery_intent','candidate_analysis']);expect(result.presentationCopy).toEqual(outputs.presentationCopy);
});

it('bundled wording cannot rescue a match with invented evidence',async()=>{
  const fixture=await new FixtureRepository().load('feedback-across-domains');const outputs=fixture.fixture.mockOutputs;
  const analysis=structuredClone(outputs.candidateAnalysis!);
  analysis.matches.forEach(m=>m.evidence.forEach(e=>{e.quote='这是一句并不存在于任何原文的证据';}));
  const llm=new MockLlmProvider({discovery_intent:outputs.intent,candidate_analysis:{...analysis,presentationCopy:outputs.presentationCopy}});
  const result=await runDiscoveryPipeline({fixtureSet:fixture.fixture.id,conversation:fixture.fixture.request.conversation!},{llm,candidateSource:new StaticCandidateSource(fixture.candidates),timeoutMs:1000,trustedContext:fixture.fixture.trustedContext});
  expect(result.status).toBe('no_match');expect(result.presentationCopy).toBeNull();expect(llm.calls).toEqual(['discovery_intent','candidate_analysis']);
});
