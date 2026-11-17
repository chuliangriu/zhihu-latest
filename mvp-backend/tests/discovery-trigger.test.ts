import { describe, expect, it } from "vitest";
import {
  DISCOVERY_TRIGGER_POLICY_VERSION,
  decideDiscoveryTrigger
} from "../src/guards/discovery-trigger.js";

const writingTopic = {
  displayId: "display-1",
  topicKey: "creative-writing.no-feedback"
};

describe("discovery entrance topic guard", () => {
  it("allows the first eligible topic", () => {
    expect(
      decideDiscoveryTrigger({
        currentTopic: {
          topicKey: writingTopic.topicKey,
          evidenceMessageIds: ["user-1"],
          transitionFromLastDisplay: null
        },
        displayedTopics: []
      })
    ).toEqual({
      allowDisplay: true,
      reasonCode: "first_topic_allowed",
      displayOrdinal: 1,
      policyVersion: DISCOVERY_TRIGGER_POLICY_VERSION
    });
  });

  it("suppresses the same topic after key normalization", () => {
    const decision = decideDiscoveryTrigger({
      currentTopic: {
        topicKey: "  CREATIVE WRITING/NO_FEEDBACK ",
        evidenceMessageIds: ["user-3"],
        transitionFromLastDisplay: {
          comparedWithTopicKey: writingTopic.topicKey,
          relation: "clear_change"
        }
      },
      displayedTopics: [writingTopic]
    });

    expect(decision).toMatchObject({
      allowDisplay: false,
      reasonCode: "same_topic_suppressed"
    });
  });

  it("suppresses a rewritten concern when the structured topic key is reused", () => {
    const decision = decideDiscoveryTrigger({
      currentTopic: {
        topicKey: writingTopic.topicKey,
        evidenceMessageIds: ["user-rephrased"],
        transitionFromLastDisplay: {
          comparedWithTopicKey: writingTopic.topicKey,
          relation: "same_topic"
        }
      },
      displayedTopics: [writingTopic]
    });

    expect(decision.reasonCode).toBe("same_topic_suppressed");
  });

  it("fails closed when a different key is not a clear topic change", () => {
    const decision = decideDiscoveryTrigger({
      currentTopic: {
        topicKey: "workplace.role-ambiguity",
        evidenceMessageIds: ["user-5"],
        transitionFromLastDisplay: {
          comparedWithTopicKey: writingTopic.topicKey,
          relation: "uncertain"
        }
      },
      displayedTopics: [writingTopic]
    });

    expect(decision).toMatchObject({
      allowDisplay: false,
      reasonCode: "topic_change_not_clear"
    });
  });

  it("allows one more display after an explicitly clear topic change", () => {
    const decision = decideDiscoveryTrigger({
      currentTopic: {
        topicKey: "family.care-boundaries",
        evidenceMessageIds: ["user-7", "user-9"],
        transitionFromLastDisplay: {
          comparedWithTopicKey: writingTopic.topicKey,
          relation: "clear_change"
        }
      },
      displayedTopics: [writingTopic]
    });

    expect(decision).toEqual({
      allowDisplay: true,
      reasonCode: "second_topic_allowed",
      displayOrdinal: 2,
      policyVersion: DISCOVERY_TRIGGER_POLICY_VERSION
    });
  });

  it("rejects a transition assessment that does not reference the latest display", () => {
    const decision = decideDiscoveryTrigger({
      currentTopic: {
        topicKey: "family.care-boundaries",
        evidenceMessageIds: ["user-7"],
        transitionFromLastDisplay: {
          comparedWithTopicKey: "some-other-topic",
          relation: "clear_change"
        }
      },
      displayedTopics: [writingTopic]
    });

    expect(decision.reasonCode).toBe("transition_reference_mismatch");
  });

  it("never displays a third discovery entrance in one session", () => {
    const decision = decideDiscoveryTrigger({
      currentTopic: {
        topicKey: "city.walking-at-night",
        evidenceMessageIds: ["user-12"],
        transitionFromLastDisplay: {
          comparedWithTopicKey: "family.care-boundaries",
          relation: "clear_change"
        }
      },
      displayedTopics: [
        writingTopic,
        { displayId: "display-2", topicKey: "family.care-boundaries" }
      ]
    });

    expect(decision).toMatchObject({
      allowDisplay: false,
      reasonCode: "session_display_limit_reached",
      displayOrdinal: null
    });
  });

  it("rejects unstructured input instead of guessing", () => {
    expect(() =>
      decideDiscoveryTrigger({
        currentTopic: {
          topicKey: "",
          evidenceMessageIds: [],
          transitionFromLastDisplay: null
        },
        displayedTopics: []
      })
    ).toThrow();
  });
});
