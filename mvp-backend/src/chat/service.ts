import type { LlmProvider, LlmUsage } from "../llm/provider.js";
import { containsForbiddenModelArtifact, scanConversationForPromptInjection } from "../security/prompt-injection.js";
import { decideDiscoveryTrigger } from "../guards/discovery-trigger.js";
import { NORMAL_REPLY_SYSTEM_PROMPT, TOPIC_ASSESSMENT_SYSTEM_PROMPT } from "../prompts/normal-reply.js";
import { topicAssessmentSchema, type ChatCompletionResult } from "./contracts.js";
import type { ConversationStore } from "./store.js";

export interface ChatTrace {
  usage: LlmUsage[];
  reasonCode: string;
}

export class ChatService {
  constructor(private readonly store: ConversationStore, private readonly createLlm: () => LlmProvider) {}

  async reply(input: { ownerId: string; conversationId: string | null; message: string; signal: AbortSignal; onChunk: (chunk: string) => void; onAnswerComplete?: (value: {conversationId:string;userMessageId:string;assistantMessageId:string})=>void }): Promise<{ result: ChatCompletionResult; trace: ChatTrace }> {
    const conversation = input.conversationId
      ? await this.store.getConversation(input.conversationId, input.ownerId)
      : await this.store.createConversation(input.ownerId);
    const history = await this.store.listMessages(conversation.id, input.ownerId, 18);
    const securityContext = { messages: [...history.filter(x => x.generationStatus === "complete").map(x => ({ id: x.id, role: x.role, content: x.content })), { id: "new", role: "user" as const, content: input.message }] };
    if (scanConversationForPromptInjection(securityContext).length > 0) throw new ChatServiceError("PROMPT_INJECTION_BLOCKED");

    const userMessage = await this.store.appendMessage({ conversationId: conversation.id, ownerId: input.ownerId, role: "user", content: input.message, generationStatus: "complete" });
    const assistantMessage = await this.store.appendMessage({ conversationId: conversation.id, ownerId: input.ownerId, role: "assistant", content: "", generationStatus: "pending" });
    const llm = this.createLlm();
    const bounded = boundContext([...history, userMessage]);
    let answer = "";
    const usage: LlmUsage[] = [];
    const topicAbort = new AbortController();
    const displays = await this.store.listTopicDisplays(conversation.id, input.ownerId);
    // Classification uses user evidence, not the assistant's guesses. Run it
    // beside the answer rather than adding another model round-trip afterward.
    const topicTask = llm.completeJson({ task: "topic_assessment", systemPrompt: `${TOPIC_ASSESSMENT_SYSTEM_PROMPT}\n\n触发补充规则：门槛保持偏低。只要最近几轮用户已经描述自己的具体处境，并表达仍未解决的犹豫、受挫、缺少反馈或是否继续，就应判定 personalSituation=true；不需要等用户再次总结，也不要求出现求助句。比如“我在写小说，但没人看，不知道要不要继续”应使用 topicKey=writing-without-readers。只有寒暄、纯事实问答、单纯介绍类型或讨论他人时才判定 false。`,
      payload: { messages: bounded.map(x => ({ id:x.id,role:x.role,content:x.content })), lastDisplayedTopic:displays.at(-1)?.topicKey??null },
      schema: topicAssessmentSchema, signal: AbortSignal.any([input.signal, topicAbort.signal])
    }).then(completion=>({completion,error:null}),error=>({completion:null,error}));
    try {
      const stream = await llm.streamText({ task: "normal_reply", systemPrompt: NORMAL_REPLY_SYSTEM_PROMPT,
        messages: bounded.map(x => ({ role: x.role, content: x.content })), signal: input.signal });
      for await (const chunk of stream.chunks) {
        answer += chunk;
        if (answer.length > 4_000) throw new ChatServiceError("MODEL_OUTPUT_REJECTED");
        input.onChunk(chunk);
      }
      usage.push(await stream.usage);
      const clean = answer.trim();
      if (!clean || /[<>\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(clean) || containsForbiddenModelArtifact([clean])) {
        throw new ChatServiceError("MODEL_OUTPUT_REJECTED");
      }
      await this.store.finishMessage(assistantMessage.id, input.ownerId, clean, "complete");
      input.onAnswerComplete?.({conversationId:conversation.id,userMessageId:userMessage.id,assistantMessageId:assistantMessage.id});

      let discovery: ChatCompletionResult["discovery"] = { eligible: false, reasonCode: "topic_assessment_unavailable", topicKey: null,
        evidenceMessageIds: [], displayOrdinal: null, policyVersion: "topic-trigger-v0.1" };
      try {
        const topicResult = await topicTask;
        if (!topicResult.completion) throw topicResult.error;
        const completion = topicResult.completion;
        usage.push(completion.usage);
        const assessment = lowerThresholdAssessment(completion.data, bounded);
        const validEvidence = assessment.evidenceMessageIds.every(id => bounded.some(x => x.id === id && x.role === "user"));
        if (!validEvidence || (assessment.personalSituation && !assessment.topicKey)) throw new ChatServiceError("TOPIC_OUTPUT_REJECTED");
        await this.store.saveTopicAssessment(conversation.id, input.ownerId, assistantMessage.id, assessment);
        if (assessment.personalSituation && assessment.topicKey) {
          const decision = decideDiscoveryTrigger({ currentTopic: { topicKey: assessment.topicKey,
            evidenceMessageIds: assessment.evidenceMessageIds,
            transitionFromLastDisplay: displays.length === 0 ? null : { comparedWithTopicKey: displays.at(-1)!.topicKey,
              relation: assessment.transition === "first" ? "uncertain" : assessment.transition } },
            displayedTopics: displays.map(x => ({ displayId: x.id, topicKey: x.topicKey })) });
          discovery = { eligible: decision.allowDisplay, reasonCode: decision.reasonCode, topicKey: assessment.topicKey,
            evidenceMessageIds: assessment.evidenceMessageIds, displayOrdinal: decision.displayOrdinal, policyVersion: decision.policyVersion };
        } else discovery.reasonCode = "not_personal_situation";
      } catch (error) {
        if (input.signal.aborted) throw error;
        const fallback = lowerThresholdAssessment({
          personalSituation: false,
          topicKey: null,
          evidenceMessageIds: [] as string[],
          transition: "first" as const,
          reason: "topic_assessment_unavailable"
        }, bounded);
        if (fallback.personalSituation && fallback.topicKey) {
          try {
            await this.store.saveTopicAssessment(conversation.id, input.ownerId, assistantMessage.id, fallback);
            const decision = decideDiscoveryTrigger({ currentTopic: {
              topicKey: fallback.topicKey,
              evidenceMessageIds: fallback.evidenceMessageIds,
              transitionFromLastDisplay: displays.length === 0 ? null : {
                comparedWithTopicKey: displays.at(-1)!.topicKey,
                relation: fallback.transition === "first" ? "uncertain" : fallback.transition
              }
            }, displayedTopics: displays.map(x => ({ displayId: x.id, topicKey: x.topicKey })) });
            discovery = { eligible: decision.allowDisplay, reasonCode: decision.reasonCode, topicKey: fallback.topicKey,
              evidenceMessageIds: fallback.evidenceMessageIds, displayOrdinal: decision.displayOrdinal, policyVersion: decision.policyVersion };
          } catch {
            discovery.reasonCode = error instanceof ChatServiceError ? error.code : "topic_assessment_unavailable";
          }
        } else discovery.reasonCode = error instanceof ChatServiceError ? error.code : "topic_assessment_unavailable";
      }
      return { result: { conversationId: conversation.id, userMessageId: userMessage.id, assistantMessageId: assistantMessage.id, discovery },
        trace: { usage, reasonCode: "chat_completed" } };
    } catch (error) {
      await this.store.finishMessage(assistantMessage.id, input.ownerId, answer.trim().slice(0,4_000), "failed").catch(() => undefined);
      throw error;
    } finally {
      topicAbort.abort();
    }
  }

  async confirmDisplay(input: { ownerId: string; conversationId: string; assistantMessageId: string; topicKey: string }) {
    const assessment = await this.store.getTopicAssessment(input.conversationId, input.ownerId, input.assistantMessageId);
    if (!assessment?.personalSituation || assessment.topicKey !== input.topicKey) throw new ChatServiceError("TOPIC_DISPLAY_NOT_ELIGIBLE");
    const displays = await this.store.listTopicDisplays(input.conversationId, input.ownerId);
    const decision = decideDiscoveryTrigger({ currentTopic: { topicKey: input.topicKey, evidenceMessageIds: assessment.evidenceMessageIds,
      transitionFromLastDisplay: displays.length === 0 ? null : { comparedWithTopicKey: displays.at(-1)!.topicKey,
        relation: assessment.transition === "first" ? "uncertain" : assessment.transition } },
      displayedTopics: displays.map(x => ({ displayId: x.id, topicKey: x.topicKey })) });
    if (!decision.allowDisplay) throw new ChatServiceError("TOPIC_DISPLAY_NOT_ELIGIBLE");
    return this.store.markTopicDisplayed(input.conversationId, input.ownerId, input.assistantMessageId, input.topicKey);
  }
}

export function lowerThresholdAssessment<T extends { personalSituation:boolean; topicKey:string|null; evidenceMessageIds:string[]; transition:"first"|"same_topic"|"clear_change"|"uncertain"; reason:string }>(
  assessment:T,
  messages:Array<{id:string;role:"user"|"assistant";content:string}>
):T {
  if (assessment.personalSituation) return assessment;
  const userMessages=messages.filter(message=>message.role==="user");
  const combined=userMessages.map(message=>message.content).join("\n");
  const personal=/(?:我|自己|我的|最近|这段时间|现在)/u.test(combined);
  const unresolved=/(?:不知道|不确定|纠结|犹豫|迷茫|困扰|担心|要不要|该不该|还要不要|继续|坚持|放弃|没人看|没有人看|没人读|没有读者|没有反馈|没反馈|没有回应|没回应)/u.test(combined);
  const concrete=/(?:写|小说|创作|作品|工作|上班|学习|学校|关系|朋友|家人|生活|项目|选择|决定)/u.test(combined);
  if (!personal || !unresolved || !concrete || combined.trim().length < 16) return assessment;
  const writingWithoutReaders=/(?:写|小说|创作|作品)/u.test(combined) && /(?:没人看|没有人看|没人读|没有读者|没有反馈|没反馈|没有回应|没回应)/u.test(combined);
  const evidenceMessageIds=userMessages.filter(message=>
    /(?:不知道|不确定|纠结|犹豫|迷茫|困扰|担心|要不要|该不该|继续|坚持|放弃|没人看|没有人看|没人读|没有读者|没有反馈|没反馈|没有回应|没回应)/u.test(message.content)
  ).map(message=>message.id).slice(-6);
  return {
    ...assessment,
    personalSituation:true,
    topicKey:writingWithoutReaders?"writing-without-readers":"personal-unresolved-situation",
    evidenceMessageIds:evidenceMessageIds.length?evidenceMessageIds:[userMessages.at(-1)!.id],
    transition:assessment.transition==="clear_change"?"clear_change":assessment.transition==="same_topic"?"same_topic":"first",
    reason:"lower_threshold_personal_situation"
  };
}

function boundContext(messages: Array<{ id: string; role: "user" | "assistant"; content: string; generationStatus?: string }>) {
  const complete = messages.filter(x => !x.generationStatus || x.generationStatus === "complete").slice(-12);
  let remaining = 12_000;
  const selected = [] as typeof complete;
  for (const message of complete.reverse()) {
    if (remaining <= 0) break;
    const content = message.content.slice(-remaining);
    selected.push({ ...message, content }); remaining -= content.length;
  }
  return selected.reverse();
}

export class ChatServiceError extends Error { constructor(public readonly code: string) { super(code); } }
