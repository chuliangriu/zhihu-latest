import type { ZodType, ZodIssue } from "zod";

export type LlmTask =
  | "normal_reply"
  | "topic_assessment"
  | "discovery_intent"
  | "candidate_analysis"
  | "presentation_copy"
  | "profile_summary"
  | "own_paper_draft";

export interface LlmUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  requests: number;
  retries: number;
}

export interface LlmCompletion<T> {
  data: T;
  usage: LlmUsage;
}

export interface CompleteJsonInput<T> {
  task: LlmTask;
  systemPrompt: string;
  payload: unknown;
  schema: ZodType<T>;
  signal: AbortSignal;
}

export interface StreamTextInput {
  task: "normal_reply";
  systemPrompt: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  signal: AbortSignal;
}

export interface TextStream {
  chunks: AsyncIterable<string>;
  usage: Promise<LlmUsage>;
}

export interface LlmProvider {
  readonly mode: "mock" | "live";
  completeJson<T>(input: CompleteJsonInput<T>): Promise<LlmCompletion<T>>;
  streamText(input: StreamTextInput): Promise<TextStream>;
}

export interface SchemaIssueDiagnostic { path: string; code: string; minimum?: number; maximum?: number; }
export function schemaIssueDiagnostics(issues: ZodIssue[]): SchemaIssueDiagnostic[] {
  const fields = new Set(['insufficientEvidence', 'background', 'recentFocus', 'unknown', 'text', 'kind', 'citations', 'refId', 'quote']);
  return issues.slice(0, 6).map(issue => ({
    path: issue.path.map(part => typeof part === 'number' ? String(part) : fields.has(part) ? part : '*').join('.') || '$',
    code: issue.code,
    ...('minimum' in issue && typeof issue.minimum === 'number' ? { minimum: issue.minimum } : {}),
    ...('maximum' in issue && typeof issue.maximum === 'number' ? { maximum: issue.maximum } : {}),
  }));
}

export class LlmProviderError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details?: { schemaIssues: SchemaIssueDiagnostic[]; usage: LlmUsage }
  ) {
    super(message);
    this.name = "LlmProviderError";
  }
}
