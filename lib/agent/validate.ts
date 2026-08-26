import type { AgentRecommendation, PlayId, PolicyVerdict } from "../types";

const VALID: PlayId[] = [
  "smart_retry",
  "payment_link",
  "hinglish_voice",
  "promise_to_pay",
  "human_escalate",
  "stop",
];

export function isValidPlayId(id: string): id is PlayId {
  return (VALID as string[]).includes(id);
}

/** Policy is authoritative — agent cannot override stop/hold/escalate. */
export function resolvePlayAfterPolicy(
  agent: AgentRecommendation,
  policy: PolicyVerdict,
  fallbackPlay: PlayId,
): PlayId {
  if (policy.action === "stop") return "stop";
  if (policy.action === "hold") {
    return policy.ruleId === "promise-to-pay" ? "promise_to_pay" : "stop";
  }
  if (policy.action === "escalate") return "human_escalate";
  if (!isValidPlayId(agent.recommendedPlay) || agent.recommendedPlay === "stop") {
    return fallbackPlay;
  }
  return agent.recommendedPlay;
}
