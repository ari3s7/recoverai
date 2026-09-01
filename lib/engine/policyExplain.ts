import { PLAY_LABEL } from "../format";
import type { PolicyAction, RunCase } from "../types";

export type PolicyHeadline = "APPROVED" | "BLOCKED" | "HELD" | "ESCALATED" | "QUEUED" | "UNEVALUATED";

export type PolicyExplanation = {
  headline: PolicyHeadline;
  reason: string;
  aiRecommendation?: string;
  override?: string;
  policyAction?: PolicyAction;
};

export function explainPolicyDecision(cse: RunCase): PolicyExplanation {
  const aiRecommendation = cse.agent ? PLAY_LABEL[cse.agent.recommendedPlay] : undefined;

  if (!cse.policy) {
    return {
      headline: "UNEVALUATED",
      reason: "Stopping rules have not been evaluated yet.",
      aiRecommendation,
    };
  }

  if (cse.executionStatus === "queued") {
    return {
      headline: "QUEUED",
      reason: cse.execution?.message ?? "Action queued for operator approval. Nothing executed.",
      aiRecommendation,
      override: "autoExecute=false. Policy authorized the play; execution waits for a human.",
      policyAction: cse.policy.action,
    };
  }

  if (cse.policy.action === "stop") {
    return {
      headline: "BLOCKED",
      reason: cse.policy.reason,
      aiRecommendation,
      override: "STOP",
      policyAction: "stop",
    };
  }

  if (cse.policy.action === "hold") {
    return {
      headline: "HELD",
      reason: cse.policy.reason,
      aiRecommendation,
      override: "HOLD",
      policyAction: "hold",
    };
  }

  if (cse.policy.action === "escalate") {
    return {
      headline: "ESCALATED",
      reason: cse.policy.reason,
      aiRecommendation,
      override: "Human approval required.",
      policyAction: "escalate",
    };
  }

  return {
    headline: "APPROVED",
    reason: cse.policy.reason || "All stopping rules clear. Agent may execute a bounded play.",
    aiRecommendation,
    policyAction: "proceed",
  };
}
