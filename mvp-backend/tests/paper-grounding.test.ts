import { describe, it, expect } from "vitest";
import { hasUnsupportedSpecifics, WorkflowService } from "../src/workflow/service.js";
import { OWN_PAPER_SYSTEM_PROMPT } from "../src/prompts/own-paper.js";
import { ownPaperModelSchema } from "../src/workflow/contracts.js";
import { MockLlmProvider } from "../src/llm/mock-provider.js";
import { InMemoryWorkflowStore } from "../src/workflow/store.js";
describe("paper grounding vocabulary",()=>{
  it("the prompt's insufficient-background example satisfies the actual schema",()=>{
    const fallback=OWN_PAPER_SYSTEM_PROMPT.match(/background 可写“([^”]+)”/)?.[1];
    expect(fallback).toBeTruthy();
    expect(ownPaperModelSchema.shape.background.safeParse(fallback).success).toBe(true);
    expect(OWN_PAPER_SYSTEM_PROMPT).toContain("quote 为8–100字");
  });
  it("accepts drawing synonyms without assigning a job",()=>{
    expect(hasUnsupportedSpecifics("这个人关注绘画和创作的进步。","我下班后画插画。")).toBe(false);
    expect(hasUnsupportedSpecifics("他在做设计工作。","我下班后画插画。")).toBe(true);
  });
  it("still rejects invented domains, works and numbers",()=>{
    expect(hasUnsupportedSpecifics("他在写小说。","我在做一件事。")).toBe(true);
    expect(hasUnsupportedSpecifics("他画了3年。","我在画画。")).toBe(true);
    expect(hasUnsupportedSpecifics("他在写《退潮信箱》。","我在写小说。")).toBe(true);
  });
  it("falls back to the user's own words when the model invents specifics",async()=>{
    const ownerId="11111111-1111-4111-8111-111111111111";
    const store=new InMemoryWorkflowStore();
    const conversation=await store.createConversation(ownerId);
    const userMessage="我最近不知道要不要继续做这件事，因为一直没有人回应。";
    await store.appendMessage({conversationId:conversation.id,ownerId,role:"user",content:userMessage,generationStatus:"complete"});
    const llm=new MockLlmProvider({own_paper_draft:{
      subject:"小说项目是否继续",
      quote:"我写小说已经3年了，现在不知道还要不要继续。",
      context:"写作项目遇到瓶颈",
      background:"这个人在学校里持续写一部小说，但作品一直没有读者。"
    }});
    const result=await new WorkflowService(store,()=>llm).draftPaper(ownerId,conversation.id,null,new AbortController().signal);
    expect(result.paper).toMatchObject({
      subject:"刚才聊到的事",
      quote:userMessage,
      context:"来自刚才的对话",
      background:"具体背景以本人刚才的原话为准。"
    });
  });
});
