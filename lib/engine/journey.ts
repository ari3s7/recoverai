import { CAUSE_LABEL, inr, LEAK_LABEL, PLAY_LABEL } from "../format";
import type { AuditEvent, RunCase } from "../types";
import { explainPolicyDecision } from "./policyExplain";

export type JourneyActor = "INGEST" | "AGENT" | "AI" | "POLICY" | "CUSTOMER";
export type JourneyStatus = "pending" | "done" | "current" | "blocked" | "skipped";
export type JourneyStepId =
  | "detect"
  | "diagnose"
  | "ai"
  | "policy"
  | "action"
  | "outcome"
  | "confirmed";

export type JourneyStep = {
  id: JourneyStepId;
  title: string;
  timestamp?: string;
  actor: JourneyActor;
  decision: string;
  status: JourneyStatus;
  reason?: string;
};

function lastOf(timeline: AuditEvent[], action: string): AuditEvent | undefined {
  return [...timeline].reverse().find((e) => e.action === action);
}

function actorOf(ev: AuditEvent | undefined, fallback: JourneyActor): JourneyActor {
  if (!ev) return fallback;
  if (ev.actor === "ingest") return "INGEST";
  if (ev.actor === "ai") return "AI";
  if (ev.actor === "policy") return "POLICY";
  if (ev.actor === "human") return "AGENT";
  return "AGENT";
}

/**
 * Visual recovery journey from persisted case state.
 * Recovery is confirmed only when recoveredInr > 0 (verified capture / settlement / operator).
 * Hidden ground truth is never copied onto steps.
 */
export function buildRecoveryJourney(cse: RunCase): JourneyStep[] {
  const detectEv = lastOf(cse.timeline, "DETECT");
  const diagnoseEv = lastOf(cse.timeline, "DIAGNOSE");
  const aiEv = lastOf(cse.timeline, "AI_DECISION");
  const policyEv = lastOf(cse.timeline, "POLICY_DECISION");
  const actionEv =
    lastOf(cse.timeline, "ACTION_EXECUTED") ??
    lastOf(cse.timeline, "ACTION_BLOCKED") ??
    lastOf(cse.timeline, "ACTION_HELD") ??
    lastOf(cse.timeline, "ACTION_ESCALATED") ??
    lastOf(cse.timeline, "ACTION_QUEUED");
  const outcomeEv = lastOf(cse.timeline, "PAYMENT_OUTCOME") ?? lastOf(cse.timeline, "RECOVERY_RESULT");
  const recovered = (cse.outcome?.recoveredInr ?? 0) > 0;
  const processed = Boolean(cse.policy || cse.agent || cse.diagnosis);
  const explanation = explainPolicyDecision(cse);

  const detect: JourneyStep = {
    id: "detect",
    title: "Detect",
    timestamp: detectEv?.ts ?? cse.occurredAt,
    actor: actorOf(detectEv, "INGEST"),
    decision: LEAK_LABEL[cse.leakType],
    status: "done",
    reason: `${inr(cse.amountInr)} at risk`,
  };

  const diagnose: JourneyStep = cse.diagnosis
    ? {
        id: "diagnose",
        title: "Diagnose",
        timestamp: diagnoseEv?.ts ?? cse.updatedAt,
        actor: "AGENT",
        decision: `Root cause: ${CAUSE_LABEL[cse.diagnosis.rootCause]}`,
        status: "done",
        reason: cse.diagnosis.evidence[0] ?? cse.diagnosis.narrative,
      }
    : {
        id: "diagnose",
        title: "Diagnose",
        actor: "AGENT",
        decision: "Awaiting diagnosis",
        status: processed ? "done" : "pending",
      };

  const predicted = cse.agent
    ? Math.round((cse.agent.aiPredictedRecoveryProbability ?? cse.agent.recoveryProbability) * 100)
    : null;
  const ai: JourneyStep = cse.agent
    ? {
        id: "ai",
        title: "AI Recommendation",
        timestamp: aiEv?.ts ?? cse.updatedAt,
        actor: "AI",
        decision: `AI recommends ${PLAY_LABEL[cse.agent.recommendedPlay]} (${predicted}%)`,
        status: "done",
        reason: cse.agent.reasoning[0],
      }
    : {
        id: "ai",
        title: "AI Recommendation",
        actor: "AI",
        decision: "No recommendation yet",
        status: "pending",
      };

  const policy: JourneyStep = cse.policy
    ? {
        id: "policy",
        title: "Policy Decision",
        timestamp: policyEv?.ts ?? cse.updatedAt,
        actor: "POLICY",
        decision: `Policy ${explanation.headline}`,
        status: explanation.headline === "BLOCKED" ? "blocked" : "done",
        reason: explanation.reason,
      }
    : {
        id: "policy",
        title: "Policy Decision",
        actor: "POLICY",
        decision: "Not evaluated",
        status: "pending",
      };

  let action: JourneyStep;
  if (!cse.executionStatus && !cse.play) {
    action = {
      id: "action",
      title: "Action Executed",
      actor: "AGENT",
      decision: "No action yet",
      status: "pending",
    };
  } else if (cse.executionStatus === "executed" && cse.play && cse.play.id !== "stop" && cse.play.id !== "human_escalate") {
    const linkIssued = Boolean(cse.paymentLinkUrl || cse.execution?.paymentLinkUrl);
    action = {
      id: "action",
      title: "Action Executed",
      timestamp: actionEv?.ts ?? cse.updatedAt,
      actor: actorOf(actionEv, "AGENT"),
      decision: linkIssued
        ? "Razorpay Payment Link created"
        : `${PLAY_LABEL[cse.play.id]} executed`,
      status: "done",
      reason: cse.execution?.message,
    };
  } else {
    action = {
      id: "action",
      title: "Action Executed",
      timestamp: actionEv?.ts ?? cse.updatedAt,
      actor: "POLICY",
      decision: "No outbound action executed",
      status: "blocked",
      reason: cse.execution?.message ?? explanation.reason,
    };
  }

  let outcome: JourneyStep;
  if (recovered) {
    outcome = {
      id: "outcome",
      title: "Customer Outcome",
      timestamp: outcomeEv?.ts ?? cse.updatedAt,
      actor: "CUSTOMER",
      decision: cse.execution?.provider === "razorpay" ? "Customer pays" : "Customer paid",
      status: "done",
      reason: cse.outcome?.note,
    };
  } else if (cse.status === "promised") {
    outcome = {
      id: "outcome",
      title: "Customer Outcome",
      timestamp: cse.updatedAt,
      actor: "CUSTOMER",
      decision: `Promised ${inr(cse.outcome?.promisedInr ?? cse.amountInr)}`,
      status: "done",
      reason: cse.outcome?.promisedDate ? `Due ${cse.outcome.promisedDate}` : cse.outcome?.note,
    };
  } else if (cse.executionStatus === "executed" && cse.play?.id === "payment_link") {
    outcome = {
      id: "outcome",
      title: "Customer Outcome",
      actor: "CUSTOMER",
      decision: "Awaiting customer payment",
      status: "current",
      reason: "Payment link issued is not recovery.",
    };
  } else if (cse.status === "stopped" || cse.status === "held" || cse.status === "escalated") {
    outcome = {
      id: "outcome",
      title: "Customer Outcome",
      actor: "CUSTOMER",
      decision: "No customer payment this cycle",
      status: "skipped",
      reason: cse.outcome?.note,
    };
  } else if (processed && cse.executionStatus === "executed") {
    outcome = {
      id: "outcome",
      title: "Customer Outcome",
      actor: "CUSTOMER",
      decision: "No conversion this cycle",
      status: "done",
      reason: cse.outcome?.note,
    };
  } else {
    outcome = {
      id: "outcome",
      title: "Customer Outcome",
      actor: "CUSTOMER",
      decision: "Awaiting customer",
      status: "pending",
    };
  }

  const confirmed: JourneyStep = recovered
    ? {
        id: "confirmed",
        title: "Verified Recovery",
        timestamp: outcomeEv?.ts ?? cse.updatedAt,
        actor: cse.execution?.provider === "razorpay" ? "INGEST" : "AGENT",
        decision: `${inr(cse.outcome!.recoveredInr)} VERIFIED RECOVERED`,
        status: "done",
        reason:
          cse.execution?.provider === "razorpay"
            ? "Webhook confirms capture"
            : cse.execution?.provider === "operator"
              ? "Operator recorded recovery"
              : "Verified sandbox settlement",
      }
    : {
        id: "confirmed",
        title: "Verified Recovery",
        actor: "INGEST",
        decision: "Recovery pending",
        status: cse.status === "stopped" || cse.status === "escalated" ? "skipped" : "pending",
        reason: "A payment link is not counted as recovered until payment is confirmed.",
      };

  const steps = [detect, diagnose, ai, policy, action, outcome, confirmed];
  const firstOpen = steps.findIndex((s) => s.status === "pending" || s.status === "current");
  return steps.map((step, i) => {
    if (step.status === "pending" && i === firstOpen) return { ...step, status: "current" };
    return step;
  });
}

export function journeyContainsHiddenTruth(steps: JourneyStep[]): boolean {
  const blob = JSON.stringify(steps);
  return blob.includes("groundTruth") || blob.includes("latentOutcome");
}
