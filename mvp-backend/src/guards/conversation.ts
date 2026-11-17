import type { ConversationContext } from "../contracts/schemas.js";

export interface ConversationPrecheck {
  eligible: boolean;
  reasonCode: string;
}

export function precheckConversation(conversation: ConversationContext): ConversationPrecheck {
  const userMessages = conversation.messages.filter((message) => message.role === "user");
  if (userMessages.length === 0) {
    return { eligible: false, reasonCode: "no_user_expression" };
  }

  const lastMessage = conversation.messages.at(-1);
  if (!lastMessage || lastMessage.role !== "assistant") {
    return { eligible: false, reasonCode: "answer_turn_incomplete" };
  }

  if (lastMessage.generationStatus && lastMessage.generationStatus !== "complete") {
    return { eligible: false, reasonCode: "answer_turn_incomplete" };
  }

  return { eligible: true, reasonCode: "precheck_passed" };
}
