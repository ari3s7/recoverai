import type { AuditEvent, CaseActionRequest } from "@/lib/types";
import { auditActionLabel, auditActorLabel } from "./audit-copy";

export { policyCaption } from "@/lib/engine/policyExplain";

export function actionBusyLabel(type: CaseActionRequest["type"]): string {
  switch (type) {
    case "live_ai":
      return "Getting independent AI recommendation…";
    case "run":
      return "Checking merchant policy…";
    case "mark_recovered":
      return "Recording operator confirmation…";
    case "stop":
      return "Stopping further recovery…";
    case "escalate":
      return "Sending to human review…";
    case "release_hold":
      return "Releasing hold…";
    case "capture_promise":
      return "Capturing promise-to-pay…";
  }
}

export function actionHelp(type: CaseActionRequest["type"]): string {
  switch (type) {
    case "live_ai":
      return "Get an independent AI recommendation only. Does not execute recovery.";
    case "run":
      return "Evaluate authorization and execute only if policy allows.";
    case "mark_recovered":
      return "Manual operator confirmation of verified recovery.";
    case "stop":
      return "Stop further recovery on this case.";
    case "escalate":
      return "Send this case to human review.";
    case "release_hold":
      return "Remove an existing hold.";
    case "capture_promise":
      return "Record a promise-to-pay. Does not count as recovered.";
  }
}

export function friendlyActionError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("timeout") || m.includes("timed out")) {
    return "AI request timed out. No action was executed.";
  }
  if (m.includes("unavailable") || m.includes("insufficient_quota") || /\b429\b/.test(m)) {
    return "AI unavailable — heuristic fallback available.";
  }
  if (m.includes("invalid") && (m.includes("json") || m.includes("response") || m.includes("validator"))) {
    return "AI response rejected by validator. No unsafe action was executed.";
  }
  if (m.includes("razorpay") && (m.includes("fail") || m.includes("link"))) {
    return "Payment link creation failed. No recovery recorded.";
  }
  if (m.includes("webhook")) {
    return "Payment may have succeeded, but RecoverAI has not received a verified webhook yet.";
  }
  return message;
}

export function auditLane(ev: AuditEvent): string {
  if (ev.action === "RECOVERY_RESULT" || (ev.moneyDeltaInr && ev.moneyDeltaInr > 0 && ev.action !== "PAYMENT_OUTCOME")) {
    return "RECOVERY";
  }
  if (
    ev.actor === "ingest" &&
    (ev.action === "PAYMENT_OUTCOME" ||
      ev.action === "webhook" ||
      /captured|webhook/i.test(ev.reason))
  ) {
    return "WEBHOOK";
  }
  return auditActorLabel(ev.actor);
}

export function auditActionShort(ev: AuditEvent): string {
  if (ev.action === "AI_DECISION") return "Recommended play";
  if (ev.action === "POLICY_DECISION") return "Policy decision";
  if (ev.action === "ACTION_EXECUTED") return "Action executed";
  if (ev.action === "ACTION_BLOCKED") return "Action blocked";
  if (ev.action === "ACTION_HELD") return "Action held";
  if (ev.action === "ACTION_ESCALATED") return "Escalated";
  if (ev.action === "ACTION_QUEUED") return "Queued";
  if (ev.action === "PAYMENT_OUTCOME") return "Payment captured";
  if (ev.action === "RECOVERY_RESULT") return "Verified recovery";
  if (ev.action === "DETECT") return "Detected at-risk revenue";
  if (ev.action === "DIAGNOSE") return "Diagnosed root cause";
  return auditActionLabel(ev.action);
}

export const AI_VS_HEURISTIC_NOTE =
  "AI recommendation is independent. Heuristic is the deterministic baseline.";
