import { LlmProviderError, type CompleteJsonInput, type LlmCompletion, type LlmProvider, type StreamTextInput, type TextStream } from "./provider.js";

/** Local UI plumbing only. Every output remains explicitly modelMode=mock. */
export class WorkflowMockProvider implements LlmProvider {
  readonly mode="mock" as const;
  async streamText(input:StreamTextInput):Promise<TextStream>{
    const text="我先接住你刚才说的这件事。现在能确定的是，你在意的不是一个抽象答案，而是这件事迟迟没有回声时，自己还能依据什么继续判断。可以先把最难拿准的那一处说得再具体一点。";
    const chunks=(async function*(){for(const part of text.match(/.{1,12}/gu)??[]){if(input.signal.aborted)throw new LlmProviderError("LLM_ABORTED","aborted");yield part;}})();
    return {chunks,usage:Promise.resolve({inputTokens:null,outputTokens:null,requests:1,retries:0})};
  }
  async completeJson<T>(input:CompleteJsonInput<T>):Promise<LlmCompletion<T>>{
    let value:unknown;
    if(input.task==="topic_assessment"){
      const payload=input.payload as {messages?:Array<{id:string;role:string}>;lastDisplayedTopic?:string|null};
      const id=[...(payload.messages??[])].reverse().find(x=>x.role==="user")?.id;
      value={personalSituation:Boolean(id),topicKey:id?"demo-personal-situation":null,evidenceMessageIds:id?[id]:[],transition:payload.lastDisplayedTopic?"same_topic":"first",reason:"本地样本模式"};
    }else if(input.task==="own_paper_draft") value={subject:"一件还没有回声的事",quote:"我还在做这件事，只是迟迟没有回声时，我越来越不知道该怎样判断下一步。",context:"本地样本 · 等待本人确认",background:"这个人仍在投入一件对自己重要的事；真正让他拿不准的，是迟迟没有足够回声来判断下一步。"};
    else throw new LlmProviderError("MOCK_OUTPUT_MISSING",`No workflow mock for ${input.task}`);
    const parsed=input.schema.safeParse(value);if(!parsed.success)throw new LlmProviderError("LLM_SCHEMA_INVALID","workflow mock invalid");
    return {data:parsed.data,usage:{inputTokens:null,outputTokens:null,requests:1,retries:0}};
  }
}
