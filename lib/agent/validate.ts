import { clampPlayToPolicy } from "../engine/policy";
import type { AgentRecommendation, PlayId, PolicyConfig, PolicyVerdict, SeedCase } from "../types";

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

/** Policy is authoritative — agent cannot override stop/hold/escalate or retry caps. */
export function resolvePlayAfterPolicy(
  agent: AgentRecommendation,
  policy: PolicyVerdict,
  fallbackPlay: PlayId,
  seed?: SeedCase,
  config?: PolicyConfig,
  at?: Date,
): PlayId {
  if (policy.action === "stop") return "stop";
  if (policy.action === "hold") {
    return policy.ruleId === "promise-to-pay" ? "promise_to_pay" : "stop";
  }
  if (policy.action === "escalate") return "human_escalate";
  const recommended =
    isValidPlayId(agent.recommendedPlay) && agent.recommendedPlay !== "stop"
      ? agent.recommendedPlay
      : fallbackPlay;
  if (seed && config && at) {
    return clampPlayToPolicy(recommended, seed, config, policy, at);
  }
  return recommended;
}
