import type { CandidateExpression, ConversationContext } from "../contracts/schemas.js";

const HARD_PATTERNS: Array<{ code: string; pattern: RegExp }> = [
  { code: "override_instructions", pattern: /(?:ignore|disregard|forget)\s+(?:all\s+)?(?:previous|prior|system|developer)\s+instructions?/i },
  { code: "override_instructions_zh", pattern: /(?:忽略|无视|忘掉|覆盖).{0,12}(?:之前|以上|系统|开发者).{0,8}(?:指令|提示词|规则)/u },
  { code: "secret_exfiltration", pattern: /(?:reveal|print|return|输出|泄露|显示).{0,20}(?:system prompt|api\s*key|access[_ -]?secret|系统提示词|密钥|令牌)/iu },
  { code: "tool_impersonation", pattern: /(?:call|invoke|execute|运行|调用).{0,12}(?:tool|function|shell|curl|工具|函数|命令)/iu },
  { code: "role_injection", pattern: /(?:^|\n)\s*(?:system|developer|assistant|系统|开发者)\s*:/iu }
];

const OUTPUT_FORBIDDEN_PATTERNS = [
  /https?:\/\//iu,
  /(?:api[_ -]?key|access[_ -]?secret|authorization|cookie)/iu,
  /(?:system|developer|assistant)\s*:/iu,
  /(?:调用|执行).{0,8}(?:工具|函数|命令)/u
];

export interface InjectionFinding {
  location: string;
  code: string;
}

export function scanConversationForPromptInjection(conversation: ConversationContext): InjectionFinding[] {
  return conversation.messages.flatMap((message) => scanText(message.content, `message:${message.id}`));
}

export function filterInjectionCandidates(candidates: CandidateExpression[]): {
  accepted: CandidateExpression[];
  rejected: InjectionFinding[];
} {
  const accepted: CandidateExpression[] = [];
  const rejected: InjectionFinding[] = [];
  for (const candidate of candidates) {
    const findings = scanText(candidate.text, `candidate:${candidate.candidateId}`);
    if (findings.length > 0) rejected.push(...findings);
    else accepted.push(candidate);
  }
  return { accepted, rejected };
}

export function containsForbiddenModelArtifact(values: string[]): boolean {
  return values.some((value) => {
    const normalized = normalizeForSecurityScan(value);
    return OUTPUT_FORBIDDEN_PATTERNS.some((pattern) => pattern.test(normalized));
  });
}

function scanText(text: string, location: string): InjectionFinding[] {
  const normalized = normalizeForSecurityScan(text);
  return HARD_PATTERNS.filter(({ pattern }) => pattern.test(normalized)).map(({ code }) => ({ location, code }));
}

function normalizeForSecurityScan(value: string): string {
  return value.normalize("NFKC").replace(/[\u200B-\u200D\u2060\uFEFF]/gu, "");
}
