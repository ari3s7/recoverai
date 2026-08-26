import type { AuditActor } from "@/lib/types";

const ACTION_LABEL: Record<string, string> = {
  detect: "DETECT",
  DETECT: "DETECT",
  AI_DECISION: "AI DECISION",
  POLICY_DECISION: "POLICY DECISION",
  ACTION_EXECUTED: "ACTION EXECUTED",
  ACTION_BLOCKED: "ACTION BLOCKED",
  ACTION_HELD: "ACTION HELD",
  ACTION_ESCALATED: "ACTION ESCALATED",
  ACTION_QUEUED: "ACTION QUEUED",
  PAYMENT_OUTCOME: "PAYMENT OUTCOME",
  RECOVERY_RESULT: "RECOVERY RESULT",
};

const ACTOR_LABEL: Record<AuditActor, string> = {
  agent: "AGENT",
  ai: "AI",
  policy: "POLICY",
  human: "HUMAN",
  ingest: "INGEST",
};

export function auditActorLabel(actor: AuditActor | string): string {
  return ACTOR_LABEL[actor as AuditActor] ?? actor.toUpperCase();
}

export function auditActionLabel(action: string): string {
  return ACTION_LABEL[action] ?? action.replace(/_/g, " ").toUpperCase();
}

export function auditHeadline(actor: AuditActor | string, action: string): string {
  return `${auditActorLabel(actor)} · ${auditActionLabel(action)}`;
}
