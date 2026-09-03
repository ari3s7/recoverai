import type { AuditEvent, CaseActionRequest, ExecutionResult, RazorpayFailureReason, RunCase } from "@/lib/types";
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

export function paymentLinkFailureCopy(reason?: RazorpayFailureReason): string {
  if (reason === "rate_limited") {
    return "Razorpay temporarily rate-limited this request. No recovery recorded.";
  }
  if (reason === "timeout") {
    return "Razorpay request timed out. No recovery recorded.";
  }
  if (reason === "transient_error") {
    return "Razorpay request failed temporarily. No recovery recorded.";
  }
  return "Razorpay rejected the payment-link request. No recovery recorded.";
}

export function executionFailureCopy(execution?: ExecutionResult): string {
  if (execution?.provider === "razorpay") return paymentLinkFailureCopy(execution.failureReason);
  return "Action failed. No recovery recorded.";
}

/** Webhook-pending copy is only for a real issued link/payment, never a create failure. */
export function shouldShowUnverifiedWebhookHint(cse: Pick<RunCase, "execution" | "executionStatus" | "play" | "outcome" | "paymentLinkUrl" | "signals">): boolean {
  if (cse.execution?.ok === false) return false;
  if ((cse.outcome?.recoveredInr ?? 0) > 0) return false;
  if (cse.paymentLinkUrl || cse.execution?.paymentLinkUrl) return false;
  const attempted =
    Boolean(cse.signals.razorpayPaymentId) ||
    (cse.execution?.ok === true && cse.execution.provider === "razorpay");
  return attempted && cse.executionStatus === "executed";
}

export function friendlyActionError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("razorpay") && (m.includes("rate-limited") || m.includes("too many") || m.includes("rate limit"))) {
    return paymentLinkFailureCopy("rate_limited");
  }
  if (m.includes("razorpay") && (m.includes("timed out") || m.includes("timeout"))) {
    return paymentLinkFailureCopy("timeout");
  }
  if (m.includes("razorpay") && (m.includes("rejected") || m.includes("invalid") || m.includes("fail") || m.includes("link"))) {
    return paymentLinkFailureCopy(m.includes("temporarily") ? "transient_error" : "permanent_error");
  }
  if (m.includes("timeout") || m.includes("timed out")) {
    return "AI timeout. Heuristic fallback available.";
  }
  if (m.includes("503") || m.includes("provider returned 503")) {
    return "AI unavailable — provider returned 503. Heuristic fallback available.";
  }
  if (m.includes("unavailable") || m.includes("insufficient_quota") || /\b429\b/.test(m)) {
    return "AI unavailable — heuristic fallback available.";
  }
  if (m.includes("invalid response")) {
    return "AI invalid response. Heuristic fallback available.";
  }
  if (m.includes("invalid") && (m.includes("json") || m.includes("response") || m.includes("validator"))) {
    return "AI rejected by validator. Heuristic fallback available.";
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
  if (ev.action === "ACTION_ATTEMPTED") return "Action attempted";
  if (ev.action === "ACTION_RETRY") return "Action retried";
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
