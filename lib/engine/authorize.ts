import type { ExecutionStatus, PlayId, PolicyConfig, PolicyVerdict } from "../types";

const OUTBOUND: PlayId[] = ["smart_retry", "payment_link", "hinglish_voice"];

export function isOutboundPlay(playId: PlayId): boolean {
  return OUTBOUND.includes(playId);
}

export type Authorization = {
  execute: boolean;
  executionStatus: ExecutionStatus;
  auditAction: "ACTION_EXECUTED" | "ACTION_BLOCKED" | "ACTION_HELD" | "ACTION_ESCALATED" | "ACTION_QUEUED";
  reason: string;
};

/**
 * Policy is authoritative. Execute only when the verdict is proceed AND
 * auto-execute is on (or the play is a no-op stop).
 */
export function authorizeExecution(
  verdict: PolicyVerdict,
  policy: PolicyConfig,
  playId: PlayId,
): Authorization {
  if (verdict.action === "stop") {
    return {
      execute: false,
      executionStatus: "blocked",
      auditAction: "ACTION_BLOCKED",
      reason: `No outbound action executed. ${verdict.reason}`,
    };
  }
  if (verdict.action === "hold") {
    return {
      execute: false,
      executionStatus: "held",
      auditAction: "ACTION_HELD",
      reason: `No outbound action executed. ${verdict.reason}`,
    };
  }
  if (verdict.action === "escalate") {
    return {
      execute: false,
      executionStatus: "escalated",
      auditAction: "ACTION_ESCALATED",
      reason: `Recovery action not executed. Human review required. ${verdict.reason}`,
    };
  }
  if (!policy.autoExecute && playId !== "stop") {
    return {
      execute: false,
      executionStatus: "queued",
      auditAction: "ACTION_QUEUED",
      reason: "Action queued for operator approval. Nothing executed.",
    };
  }
  return {
    execute: true,
    executionStatus: "executed",
    auditAction: "ACTION_EXECUTED",
    reason: "",
  };
}
