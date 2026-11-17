import { z } from "zod";

export const DISCOVERY_TRIGGER_POLICY_VERSION = "topic-trigger-v0.1";
export const MAX_DISCOVERY_DISPLAYS_PER_SESSION = 2;

const topicKeySchema = z.string().trim().min(1).max(120);

export const displayedTopicSchema = z
  .object({
    displayId: z.string().trim().min(1).max(80),
    topicKey: topicKeySchema
  })
  .strict();

export const currentTopicSchema = z
  .object({
    topicKey: topicKeySchema,
    evidenceMessageIds: z.array(z.string().trim().min(1).max(80)).min(1).max(12),
    transitionFromLastDisplay: z
      .object({
        comparedWithTopicKey: topicKeySchema,
        relation: z.enum(["same_topic", "clear_change", "uncertain"])
      })
      .strict()
      .nullable()
  })
  .strict();

export const discoveryTriggerInputSchema = z
  .object({
    currentTopic: currentTopicSchema,
    displayedTopics: z.array(displayedTopicSchema).max(MAX_DISCOVERY_DISPLAYS_PER_SESSION)
  })
  .strict();

export type DiscoveryTriggerInput = z.infer<typeof discoveryTriggerInputSchema>;

export type DiscoveryTriggerReasonCode =
  | "first_topic_allowed"
  | "second_topic_allowed"
  | "same_topic_suppressed"
  | "topic_change_not_clear"
  | "transition_reference_mismatch"
  | "session_display_limit_reached";

export type DiscoveryTriggerDecision =
  | {
      allowDisplay: true;
      reasonCode: "first_topic_allowed" | "second_topic_allowed";
      displayOrdinal: 1 | 2;
      policyVersion: typeof DISCOVERY_TRIGGER_POLICY_VERSION;
    }
  | {
      allowDisplay: false;
      reasonCode: Exclude<
        DiscoveryTriggerReasonCode,
        "first_topic_allowed" | "second_topic_allowed"
      >;
      displayOrdinal: null;
      policyVersion: typeof DISCOVERY_TRIGGER_POLICY_VERSION;
    };

/**
 * Decides only whether the discovery entrance may be shown in this session.
 *
 * `topicKey` is a canonical, structured key produced before this guard runs.
 * Paraphrases of the same concern must reuse the same key. This function does
 * not infer semantic similarity, search for people, or decide that a match
 * exists.
 *
 * `displayedTopics` contains successful entrance displays, not searches or
 * model attempts. Therefore a failed search does not consume a display slot.
 */
export function decideDiscoveryTrigger(input: unknown): DiscoveryTriggerDecision {
  const parsed = discoveryTriggerInputSchema.parse(input);
  const currentKey = normalizeTopicKey(parsed.currentTopic.topicKey);
  const displayed = parsed.displayedTopics.map((topic) => ({
    ...topic,
    normalizedTopicKey: normalizeTopicKey(topic.topicKey)
  }));

  if (displayed.length >= MAX_DISCOVERY_DISPLAYS_PER_SESSION) {
    return blocked("session_display_limit_reached");
  }

  if (displayed.length === 0) {
    return {
      allowDisplay: true,
      reasonCode: "first_topic_allowed",
      displayOrdinal: 1,
      policyVersion: DISCOVERY_TRIGGER_POLICY_VERSION
    };
  }

  if (displayed.some((topic) => topic.normalizedTopicKey === currentKey)) {
    return blocked("same_topic_suppressed");
  }

  const lastDisplayed = displayed.at(-1)!;
  const transition = parsed.currentTopic.transitionFromLastDisplay;
  if (
    !transition ||
    normalizeTopicKey(transition.comparedWithTopicKey) !== lastDisplayed.normalizedTopicKey
  ) {
    return blocked("transition_reference_mismatch");
  }

  if (transition.relation !== "clear_change") {
    return blocked(
      transition.relation === "same_topic" ? "same_topic_suppressed" : "topic_change_not_clear"
    );
  }

  return {
    allowDisplay: true,
    reasonCode: "second_topic_allowed",
    displayOrdinal: 2,
    policyVersion: DISCOVERY_TRIGGER_POLICY_VERSION
  };
}

function normalizeTopicKey(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase("en-US")
    .replace(/[\s._/]+/g, "-")
    .replace(/-+/g, "-");
}

function blocked(
  reasonCode: Exclude<
    DiscoveryTriggerReasonCode,
    "first_topic_allowed" | "second_topic_allowed"
  >
): DiscoveryTriggerDecision {
  return {
    allowDisplay: false,
    reasonCode,
    displayOrdinal: null,
    policyVersion: DISCOVERY_TRIGGER_POLICY_VERSION
  };
}
