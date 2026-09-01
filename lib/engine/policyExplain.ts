import { PLAY_LABEL } from "../format";
import type { PolicyAction, RunCase } from "../types";

export type PolicyHeadline = "APPROVED" | "BLOCKED" | "HELD" | "ESCALATED" | "QUEUED" | "UNEVALUATED";

export type PolicyExplanation = {
  headline: PolicyHeadline;
  /** Demo-facing one-liner. The stored policy reason is in `reason`. */
  caption: string;
  reason: string;
  aiRecommendation?: string;
  override?: string;
  policyAction?: PolicyAction;
};

export function policyCaption(headline: PolicyHeadline): string {
  switch (headline) {
    case "APPROVED":
      return "Policy allows this action.";
    case "BLOCKED":
      return "Policy blocked this action.";
    case "HELD":
      return "Action paused until the policy window opens.";
    case "ESCALATED":
      return "Human approval required because this case exceeds a configured gate.";
    case "QUEUED":
      return "AI recommendation approved, but auto-execution is disabled.";
    case "UNEVALUATED":
      return "Policy has not been evaluated yet.";
  }
}

function withCaption(
  row: Omit<PolicyExplanation, "caption"> & { headline: PolicyHeadline },
): PolicyExplanation {
  return { ...row, caption: policyCaption(row.headline) };
}

export function explainPolicyDecision(cse: RunCase): PolicyExplanation {
  const aiRecommendation = cse.agent ? PLAY_LABEL[cse.agent.recommendedPlay] : undefined;

  if (!cse.policy) {
    return withCaption({
      headline: "UNEVALUATED",
      reason: "Stopping rules have not been evaluated yet.",
      aiRecommendation,
    });
  }

  if (cse.executionStatus === "queued") {
    return withCaption({
      headline: "QUEUED",
      reason: cse.execution?.message ?? "AI recommendation approved, but auto-execution is disabled.",
      aiRecommendation,
      override: "autoExecute=false. Policy authorized the play; execution waits for a human.",
      policyAction: cse.policy.action,
    });
  }

  if (cse.policy.action === "stop") {
    return withCaption({
      headline: "BLOCKED",
      reason: cse.policy.reason,
      aiRecommendation,
      override: "STOP",
      policyAction: "stop",
    });
  }

  if (cse.policy.action === "hold") {
    return withCaption({
      headline: "HELD",
      reason: cse.policy.reason,
      aiRecommendation,
      override: "HOLD",
      policyAction: "hold",
    });
  }

  if (cse.policy.action === "escalate") {
    return withCaption({
      headline: "ESCALATED",
      reason: cse.policy.reason,
      aiRecommendation,
      override: "Human approval required.",
      policyAction: "escalate",
    });
  }

  return withCaption({
    headline: "APPROVED",
    reason: cse.policy.reason || "All stopping rules clear. Agent may execute a bounded play.",
    aiRecommendation,
    policyAction: "proceed",
  });
}
