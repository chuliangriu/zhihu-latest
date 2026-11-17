import { describe, expect, it } from "vitest";
import { lowerThresholdAssessment } from "../src/chat/service.js";

const negative = {
  personalSituation: false,
  topicKey: null,
  evidenceMessageIds: [] as string[],
  transition: "first" as const,
  reason: "ordinary_chat"
};

describe("lower discovery threshold", () => {
  it("recognizes a writing dilemma accumulated across short turns", () => {
    const result = lowerThresholdAssessment(negative, [
      { id: "11111111-1111-4111-8111-111111111111", role: "user", content: "我最近在写一个小说，但不知道还应不应该继续写，因为没人看。" },
      { id: "22222222-2222-4222-8222-222222222222", role: "assistant", content: "你写的是哪种类型？" },
      { id: "33333333-3333-4333-8333-333333333333", role: "user", content: "恐怖类。" }
    ]);
    expect(result).toMatchObject({ personalSituation: true, topicKey: "writing-without-readers" });
    expect(result.evidenceMessageIds).toContain("11111111-1111-4111-8111-111111111111");
  });

  it("does not trigger on a simple greeting or genre preference", () => {
    expect(lowerThresholdAssessment(negative, [
      { id: "11111111-1111-4111-8111-111111111111", role: "user", content: "你好，我喜欢恐怖小说。" }
    ]).personalSituation).toBe(false);
  });
});
