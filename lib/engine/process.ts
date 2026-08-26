import { inr, CAUSE_LABEL } from "../format";
import { uid } from "../ids";
import { recommendRecovery } from "../agent/recommend";
import { resolvePlayAfterPolicy } from "../agent/validate";
import type {
  AuditEvent,
  CaseStatus,
  ExecutionResult,
  Outcome,
  Play,
  PolicyConfig,
  RunCase,
} from "../types";
import { authorizeExecution } from "./authorize";
import { executePlay } from "./execute";
import { evaluatePolicy } from "./policy";
import { isBreachedPromise } from "./promise";
import { buildPlayForId, selectPlay } from "./plays";

function stamp(caseId: string, actor: AuditEvent["actor"], action: string, reason: string, moneyDeltaInr?: number): AuditEvent {
  return {
    id: uid("evt"),
    ts: new Date().toISOString(),
    caseId,
    actor,
    action,
    reason,
    moneyDeltaInr,
  };
}

function plusDays(from: Date, days: number): string {
  const d = new Date(from);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function bumpContacts(c: RunCase, play: Play, nowIso: string): RunCase {
  const outbound = play.id === "smart_retry" || play.id === "payment_link" || play.id === "hinglish_voice";
  if (!outbound) return c;
  const mandateRetry =
    play.id === "smart_retry"
      ? (c.signals.mandateRetryCount ?? c.signals.retryCount) + 1
      : c.signals.mandateRetryCount;
  return {
    ...c,
    signals: {
      ...c.signals,
      contactsLast7Days: c.signals.contactsLast7Days + 1,
      lastContactAt: nowIso,
      lastRetryAt: play.id === "smart_retry" ? nowIso : c.signals.lastRetryAt,
      retryCount: play.id === "smart_retry" ? c.signals.retryCount + 1 : c.signals.retryCount,
      mandateRetryCount: play.id === "smart_retry" ? mandateRetry : c.signals.mandateRetryCount,
    },
  };
}

function skippedExecution(reason: string, provider: ExecutionResult["provider"]): ExecutionResult {
  return {
    ok: true,
    settled: false,
    provider,
    referenceId: uid("exec"),
    message: reason,
  };
}

export async function processCase(
  current: RunCase,
  policy: PolicyConfig,
  now: Date,
  opts?: { useLiveLlm?: boolean; utterance?: string },
): Promise<RunCase> {
  const ts = now.toISOString();
  if (current.status === "recovered" && (current.outcome?.recoveredInr ?? 0) > 0) {
    const event = stamp(
      current.id,
      "policy",
      "POLICY_DECISION",
      "Payment already succeeded. Recovery sequence stopped.",
    );
    return {
      ...current,
      timeline: [...current.timeline, event],
      updatedAt: ts,
    };
  }
  const timeline: AuditEvent[] = [];

  timeline.push(
    stamp(current.id, "agent", "detect", `${current.leakType} · ${inr(current.amountInr)} at risk`),
  );

  if (isBreachedPromise(current, now)) {
    timeline.push(
      stamp(
        current.id,
        "policy",
        "POLICY_DECISION",
        `Promise-to-pay ${current.signals.promiseToPayDate} is past due. Hold released; recovery follows remaining policy.`,
      ),
    );
  }

  const { diagnosis, agent } = await recommendRecovery(current, {
    policy,
    forceHeuristic: !opts?.useLiveLlm,
    utterance: opts?.utterance,
  });
  const decisionLabel = agent.provider === "heuristic" ? "RecoverAI recovery policy" : "Live AI agent";
  timeline.push(
    stamp(
      current.id,
      "ai",
      "AI_DECISION",
      `${decisionLabel}: ${agent.recommendedPlay} · predicted ${Math.round((agent.aiPredictedRecoveryProbability ?? agent.recoveryProbability) * 100)}% · ${agent.provider} · ${CAUSE_LABEL[agent.rootCause]} (${agent.confidence}% confidence) · ${agent.reasoning.slice(0, 3).join("; ")}`,
    ),
  );

  const verdict = evaluatePolicy(current, policy, now);
  timeline.push(
    stamp(
      current.id,
      "policy",
      "POLICY_DECISION",
      `${verdict.action}${verdict.ruleId ? ` · ${verdict.ruleId}` : ""}: ${verdict.reason}`,
    ),
  );

  const ruleFallback = selectPlay(current, diagnosis, verdict);
  const playId = resolvePlayAfterPolicy(agent, verdict, ruleFallback.id, current, policy, now);
  const play = buildPlayForId(
    current,
    agent.rootCause,
    playId,
    `AI recommended ${agent.recommendedPlay}. Policy resolved to ${playId}. ${agent.reasoning[0] ?? ""}`,
  );
  if (playId !== agent.recommendedPlay) {
    timeline.push(
      stamp(
        current.id,
        "policy",
        "POLICY_DECISION",
        `Recommended ${agent.recommendedPlay} was not authorized. Policy ${verdict.action}${verdict.ruleId ? ` · ${verdict.ruleId}` : ""} → ${playId}.`,
      ),
    );
  }

  const auth = authorizeExecution(verdict, policy, playId);

  let execution: ExecutionResult;
  if (!auth.execute) {
    execution = skippedExecution(
      auth.reason,
      auth.executionStatus === "queued" || auth.executionStatus === "escalated" ? "operator" : "policy",
    );
    timeline.push(stamp(current.id, "policy", auth.auditAction, auth.reason));
  } else {
    execution = await executePlay(current, play, agent.rootCause);
    timeline.push(
      stamp(
        current.id,
        execution.provider === "operator" ? "human" : "agent",
        "ACTION_EXECUTED",
        execution.message,
      ),
    );
  }

  let status: CaseStatus = "at_risk";
  let outcome: Outcome;

  if (verdict.action === "stop") {
    status = "stopped";
    outcome = { status: "stopped", recoveredInr: 0, promisedInr: 0, note: verdict.reason };
  } else if (verdict.action === "hold") {
    if (verdict.ruleId === "promise-to-pay") {
      status = "promised";
      outcome = {
        status: "promised",
        recoveredInr: 0,
        promisedInr: current.amountInr,
        promisedDate: current.signals.promiseToPayDate,
        note: verdict.reason,
      };
    } else {
      status = "held";
      outcome = { status: "held", recoveredInr: 0, promisedInr: 0, note: verdict.reason };
    }
  } else if (verdict.action === "escalate") {
    status = "escalated";
    outcome = { status: "escalated", recoveredInr: 0, promisedInr: 0, note: verdict.reason };
  } else if (!auth.execute) {
    status = "escalated";
    outcome = {
      status: "escalated",
      recoveredInr: 0,
      promisedInr: 0,
      note: auth.reason,
    };
  } else if (play.id === "promise_to_pay") {
    const date = current.signals.promiseToPayDate ?? plusDays(now, 7);
    status = "promised";
    outcome = {
      status: "promised",
      recoveredInr: 0,
      promisedInr: current.amountInr,
      promisedDate: date,
      note: `Promise-to-pay ${date}. Collections paused.`,
    };
  } else if (execution.settled) {
    status = "recovered";
    outcome = {
      status: "recovered",
      recoveredInr: current.amountInr,
      promisedInr: 0,
      note: execution.message,
    };
  } else {
    status = "at_risk";
    outcome = {
      status: "at_risk",
      recoveredInr: 0,
      promisedInr: 0,
      note: execution.message,
    };
  }

  if (outcome.recoveredInr > 0) {
    timeline.push(
      stamp(
        current.id,
        execution.provider === "razorpay" ? "ingest" : "agent",
        "PAYMENT_OUTCOME",
        execution.provider === "razorpay"
          ? `Razorpay verified capture · ${inr(outcome.recoveredInr)} (AI predicted ${Math.round((agent.aiPredictedRecoveryProbability ?? agent.recoveryProbability) * 100)}%)`
          : `Sandbox settlement · ${inr(outcome.recoveredInr)} · predicted ${Math.round((agent.aiPredictedRecoveryProbability ?? agent.recoveryProbability) * 100)}% (prediction ≠ recovery)`,
        outcome.recoveredInr,
      ),
    );
    timeline.push(
      stamp(
        current.id,
        "agent",
        "RECOVERY_RESULT",
        `actualRecovered ${inr(outcome.recoveredInr)}`,
        outcome.recoveredInr,
      ),
    );
  }

  let next: RunCase = {
    ...current,
    status,
    diagnosis,
    agent,
    policy: verdict,
    play,
    outcome,
    execution,
    executionStatus: auth.executionStatus,
    paymentLinkUrl: auth.execute ? (execution.paymentLinkUrl ?? current.paymentLinkUrl) : current.paymentLinkUrl,
    timeline: [...current.timeline, ...timeline],
    updatedAt: ts,
  };

  if (auth.execute) {
    next = bumpContacts(next, play, ts);
  }

  if (status === "promised" && outcome.promisedDate) {
    next.signals = { ...next.signals, promiseToPayDate: outcome.promisedDate };
  }
  if (status === "recovered") {
    next.signals = { ...next.signals, promiseToPayDate: undefined };
  }
  if (auth.execute && execution.provider === "razorpay") {
    next.signals = { ...next.signals, razorpayPaymentLinkId: execution.referenceId };
  }

  return next;
}

export { stamp };
