import type { LlmTask } from "./provider.js";
import { LlmProviderError, schemaIssueDiagnostics, type CompleteJsonInput, type LlmCompletion, type LlmProvider, type StreamTextInput, type TextStream } from "./provider.js";

export class MockLlmProvider implements LlmProvider {
  readonly mode = "mock" as const;
  readonly calls: LlmTask[] = [];
  readonly inputs: Array<Pick<CompleteJsonInput<unknown>, "task" | "systemPrompt" | "payload">> = [];

  constructor(private readonly outputs: Partial<Record<LlmTask, unknown>>) {}

  async completeJson<T>(input: CompleteJsonInput<T>): Promise<LlmCompletion<T>> {
    if (input.signal.aborted) {
      throw new LlmProviderError("LLM_ABORTED", "Mock LLM request was aborted");
    }

    this.calls.push(input.task);
    this.inputs.push({ task: input.task, systemPrompt: input.systemPrompt, payload: input.payload });
    const output = this.outputs[input.task];
    if (output === undefined) {
      throw new LlmProviderError("MOCK_OUTPUT_MISSING", `No mock output for ${input.task}`);
    }

    const parsed = input.schema.safeParse(output);
    if (!parsed.success) {
      throw new LlmProviderError("LLM_SCHEMA_INVALID", "Mock LLM output failed schema validation", {
        schemaIssues: schemaIssueDiagnostics(parsed.error.issues),
        usage: { inputTokens: null, outputTokens: null, requests: 1, retries: 0 }
      });
    }

    return {
      data: parsed.data,
      usage: { inputTokens: null, outputTokens: null, requests: 1, retries: 0 }
    };
  }

  async streamText(input: StreamTextInput): Promise<TextStream> {
    if (input.signal.aborted) throw new LlmProviderError("LLM_ABORTED", "Mock LLM request was aborted");
    this.calls.push(input.task);
    const output = this.outputs.normal_reply;
    if (typeof output !== "string" || output.trim() === "") {
      throw new LlmProviderError("MOCK_OUTPUT_MISSING", "No mock output for normal_reply");
    }
    const chunks = (async function* () {
      for (const part of output.match(/.{1,12}/gu) ?? []) {
        if (input.signal.aborted) throw new LlmProviderError("LLM_ABORTED", "Mock LLM request was aborted");
        yield part;
      }
    })();
    return { chunks, usage: Promise.resolve({ inputTokens: null, outputTokens: null, requests: 1, retries: 0 }) };
  }
}
