import { afterEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../src/config.js";
import { discoveryIntentOutputSchema } from "../src/contracts/schemas.js";
import { profileModelSchema } from "../src/profile/contracts.js";
import { OpenAiCompatibleProvider } from "../src/llm/openai-compatible-provider.js";

const config = loadConfig({
  NODE_ENV: "test",
  LLM_MODE: "live",
  LLM_API_KEY: "server-only-test-key",
  LLM_BASE_URL: "https://provider.example/v1",
  LLM_ALLOWED_HOSTS: "provider.example",
  LLM_MODEL: "test-model",
  LLM_MAX_RETRIES: "0"
});

afterEach(() => vi.unstubAllGlobals());

describe("live LLM adapter", () => {
  it("streams text and retries only before any output is emitted",async()=>{
    const streamingConfig=loadConfig({NODE_ENV:"test",LLM_MODE:"live",LLM_API_KEY:"server-only-test-key",LLM_BASE_URL:"https://provider.example/v1",LLM_ALLOWED_HOSTS:"provider.example",LLM_MODEL:"test-model",LLM_MAX_RETRIES:"1"});
    const fetchMock=vi.fn().mockResolvedValueOnce(new Response("busy",{status:429})).mockResolvedValueOnce(new Response([
      'data: {"choices":[{"delta":{"content":"你说的"}}]}',
      'data: {"choices":[{"delta":{"content":"这件事"}}]}',
      'data: [DONE]',''
    ].join("\n"),{status:200,headers:{"Content-Type":"text/event-stream"}}));
    vi.stubGlobal("fetch",fetchMock);const stream=await new OpenAiCompatibleProvider(streamingConfig.llm).streamText({task:"normal_reply",systemPrompt:"answer",messages:[{role:"user",content:"test"}],signal:new AbortController().signal});
    let text="";for await(const part of stream.chunks)text+=part;
    expect(text).toBe("你说的这件事");expect(await stream.usage).toEqual({inputTokens:null,outputTokens:null,requests:2,retries:1});expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("cancels an abandoned stream and still settles usage",async()=>{
    const cancel=vi.fn();
    const body=new ReadableStream<Uint8Array>({
      start(controller){
        controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"第一段"}}]}\n\n'));
      },
      cancel
    });
    vi.stubGlobal("fetch",vi.fn().mockResolvedValue(new Response(body,{status:200,headers:{"Content-Type":"text/event-stream"}})));
    const stream=await new OpenAiCompatibleProvider(config.llm).streamText({task:"normal_reply",systemPrompt:"answer",messages:[{role:"user",content:"test"}],signal:new AbortController().signal});
    for await(const _part of stream.chunks)break;
    expect(await stream.usage).toEqual({inputTokens:null,outputTokens:null,requests:1,retries:0});
    expect(cancel).toHaveBeenCalledTimes(1);
  });
  it("calls the configured server-side endpoint and validates JSON", async () => {
    const output = {
      shouldSearch: false,
      reasonCodes: ["factual_query"],
      primaryDomain: null,
      explicitConcerns: [],
      uncertainPoints: [],
      searchDirections: [],
      refusalReason: "纯事实查询"
    };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify(output) } }],
          usage: { prompt_tokens: 12, completion_tokens: 8 }
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const completion = await new OpenAiCompatibleProvider(config.llm).completeJson({
      task: "discovery_intent",
      systemPrompt: "Return JSON",
      payload: { userMessages: [] },
      schema: discoveryIntentOutputSchema,
      signal: new AbortController().signal
    });

    expect(completion.data.shouldSearch).toBe(false);
    expect(completion.usage).toEqual({ inputTokens: 12, outputTokens: 8, requests: 1, retries: 0 });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://provider.example/v1/chat/completions");
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer server-only-test-key");
  });

  it("rejects provider JSON that violates the task schema", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ choices: [{ message: { content: "{\"unexpected\":true}" } }] }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        })
      )
    );

    await expect(
      new OpenAiCompatibleProvider(config.llm).completeJson({
        task: "discovery_intent",
        systemPrompt: "Return JSON",
        payload: {},
        schema: discoveryIntentOutputSchema,
        signal: new AbortController().signal
      })
    ).rejects.toMatchObject({ code: "LLM_SCHEMA_INVALID" });
  });
});


describe("reasoning model compatibility", () => {
  const glm = loadConfig({ LLM_MODEL: "glm-5.3", LLM_API_KEY: "server-only-test-key", LLM_MAX_RETRIES: "0" }).llm;
  it("sends low reasoning and the configured budget for both JSON and SSE", async () => {
    const output = { shouldSearch: false, reasonCodes: ["factual_query"], primaryDomain: null, explicitConcerns: [], uncertainPoints: [], searchDirections: [], refusalReason: "事实查询" };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ choices: [{ message: { content: JSON.stringify(output) }, finish_reason: "stop" }] }))
      .mockResolvedValueOnce(new Response('data: {"choices":[{"delta":{"content":"你好"},"finish_reason":null}]}\n\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'));
    vi.stubGlobal("fetch", fetchMock);
    const provider = new OpenAiCompatibleProvider(glm);
    await provider.completeJson({ task: "discovery_intent", systemPrompt: "Return JSON", payload: {}, schema: discoveryIntentOutputSchema, signal: new AbortController().signal });
    const stream = await provider.streamText({ task: "normal_reply", systemPrompt: "Answer", messages: [{ role: "user", content: "你好" }], signal: new AbortController().signal });
    let text = ""; for await (const part of stream.chunks) text += part;
    expect(text).toBe("你好");
    for (const call of fetchMock.mock.calls) expect(JSON.parse(call[1].body)).toMatchObject({ model: "glm-5.3", reasoning_effort: "low", max_tokens: 4096 });
  });
  it.each([{ reasoning_content: "thinking" }, { content: "partial answer" }])("rejects a length-limited stream rather than reporting success or an empty response", async (delta) => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(`data: ${JSON.stringify({ choices: [{ delta, finish_reason: null }] })}\n\ndata: {"choices":[{"delta":{},"finish_reason":"length"}]}\n\ndata: [DONE]\n\n`));
    vi.stubGlobal("fetch", fetchMock);
    const stream = await new OpenAiCompatibleProvider(glm).streamText({ task: "normal_reply", systemPrompt: "Answer", messages: [{ role: "user", content: "test" }], signal: new AbortController().signal });
    await expect((async () => { for await (const _part of stream.chunks) {} })()).rejects.toMatchObject({ code: "LLM_OUTPUT_LIMIT_REACHED" });
    await expect(stream.usage).resolves.toBeDefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("rejects even parseable JSON when the provider reports truncation", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ choices: [{ message: { content: "{}" }, finish_reason: "length" }] }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(new OpenAiCompatibleProvider(glm).completeJson({ task: "discovery_intent", systemPrompt: "JSON", payload: {}, schema: discoveryIntentOutputSchema, signal: new AbortController().signal })).rejects.toMatchObject({ code: "LLM_OUTPUT_LIMIT_REACHED" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

it("schema diagnostics exclude response values and arbitrary field names",async()=>{
  const fetcher=vi.fn().mockResolvedValue(Response.json({choices:[{message:{content:JSON.stringify({insufficientEvidence:true,background:[],recentFocus:null,unknown:{private:"private-value-do-not-record"},"private-key-do-not-record":"secret-do-not-record"})}}],usage:{prompt_tokens:10,completion_tokens:5}}));
  vi.stubGlobal("fetch",fetcher);
  try {
    await new OpenAiCompatibleProvider(config.llm).completeJson({task:"profile_summary",systemPrompt:"JSON",payload:{},schema:profileModelSchema,signal:new AbortController().signal});
    throw new Error("Expected schema rejection");
  } catch(error:any) {
    expect(error.code).toBe("LLM_SCHEMA_INVALID");expect(error.details.schemaIssues).toContainEqual({path:"unknown",code:"invalid_type"});
    expect(error.details.usage).toEqual({inputTokens:10,outputTokens:5,requests:1,retries:0});
    expect(JSON.stringify(error)).not.toMatch(/private-value|private-key|secret-do-not-record/);
  }
});
