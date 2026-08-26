import { inr } from "../format";
import { uid } from "../ids";
import type {
  AuditEvent,
  CaseStatus,
  Diagnosis,
  Outcome,
  Play,
  PolicyConfig,
  PolicyVerdict,
  RunCase,
} from "../types";
import { diagnose } from "./diagnose";
import { executePlay } from "./execute";
import { evaluatePolicy } from "./policy";
import { selectPlay } from "./plays";

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

function outcomeFrom(input: {
  seed: RunCase;
  play: Play;
  policy: PolicyVerdict;
  diagnosis: Diagnosis;
  executionOk: boolean;
  now: Date;
}): Outcome {
  const { seed, play, policy, executionOk, now } = input;
  if (policy.action === "stop" || play.id === "stop") {
    const held = policy.action === "hold" && policy.ruleId === "quiet-hours";
    if (held) {
      return { status: "held", recoveredInr: 0, promisedInr: 0, note: policy.reason };
    }
    if (policy.action === "hold") {
      return {
        status: "promised",
        recoveredInr: 0,
        promisedInr: seed.amountInr,
        promisedDate: seed.signals.promiseToPayDate,
        note: policy.reason,
      };
    }
    return { status: "stopped", recoveredInr: 0, promisedInr: 0, note: policy.reason };
  }
  if (play.id === "human_escalate") {
    return { status: "escalated", recoveredInr: 0, promisedInr: 0, note: play.reason };
  }
  if (play.id === "promise_to_pay") {
    const date = seed.signals.promiseToPayDate ?? plusDays(now, 7);
    return {
      status: "promised",
      recoveredInr: 0,
      promisedInr: seed.amountInr,
      promisedDate: date,
      note: `Promise-to-pay ${date}. Collections paused.`,
    };
  }
  if (executionOk) {
    return {
      status: "recovered",
      recoveredInr: seed.amountInr,
      promisedInr: 0,
      note: `Recovered ${inr(seed.amountInr)} this cycle.`,
    };
  }
  return {
    status: "at_risk",
    recoveredInr: 0,
    promisedInr: 0,
    note: "Play executed. No conversion this cycle. Sequence stops until a new signal.",
  };
}

function bumpContacts(c: RunCase, play: Play, nowIso: string): RunCase {
  const outbound = play.id === "smart_retry" || play.id === "payment_link" || play.id === "hinglish_voice";
  if (!outbound) return c;
  return {
    ...c,
    signals: {
      ...c.signals,
      contactsLast7Days: c.signals.contactsLast7Days + 1,
      lastContactAt: nowIso,
      retryCount: play.id === "smart_retry" ? c.signals.retryCount + 1 : c.signals.retryCount,
    },
  };
}

export async function processCase(current: RunCase, policy: PolicyConfig, now: Date): Promise<RunCase> {
  const ts = now.toISOString();
  const timeline: AuditEvent[] = [];
  const diagnosis = diagnose(current);
  timeline.push(
    stamp(current.id, "agent", "detect", `${current.leakType} · ${inr(current.amountInr)} at risk`),
  );
  timeline.push(
    stamp(
      current.id,
      "agent",
      "diagnose",
      `${diagnosis.label} (${diagnosis.confidence}% confidence)`,
    ),
  );

  const verdict = evaluatePolicy(current, policy, now);
  timeline.push(stamp(current.id, "policy", verdict.ruleId ?? verdict.action, verdict.reason));

  const play = selectPlay(current, diagnosis, verdict);
  timeline.push(stamp(current.id, "agent", `play:${play.id}`, play.reason));

  const execution = await executePlay(current, play, diagnosis.rootCause);
  const result = outcomeFrom({
    seed: current,
    play,
    policy: verdict,
    diagnosis,
    executionOk: execution.ok && play.id !== "stop" && play.id !== "human_escalate" && play.id !== "promise_to_pay" && verdict.action === "proceed",
    now,
  });

  // hold / stop / escalate outcomes from policy, not sandbox roll
  let status: CaseStatus = result.status;
  let outcome = result;
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
  } else if (!policy.autoExecute && play.id !== "stop") {
    status = "escalated";
    outcome = {
      status: "escalated",
      recoveredInr: 0,
      promisedInr: 0,
      note: "Auto-execute is off. Play is queued for operator approval.",
    };
  } else if (play.id === "promise_to_pay") {
    status = "promised";
    outcome = result;
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

  timeline.push(
    stamp(
      current.id,
      execution.provider === "operator" ? "human" : "agent",
      "execute",
      execution.message,
      outcome.recoveredInr || undefined,
    ),
  );

  const next: RunCase = bumpContacts(
    {
      ...current,
      status,
      diagnosis,
      policy: verdict,
      play,
      outcome,
      execution,
      paymentLinkUrl: execution.paymentLinkUrl ?? current.paymentLinkUrl,
      timeline: [...current.timeline, ...timeline],
      updatedAt: ts,
    },
    play,
    ts,
  );

  if (status === "promised" && outcome.promisedDate) {
    next.signals = { ...next.signals, promiseToPayDate: outcome.promisedDate };
  }
  if (status === "recovered") {
    next.signals = { ...next.signals, promiseToPayDate: undefined };
  }
  if (execution.provider === "razorpay") {
    next.signals = { ...next.signals, razorpayPaymentLinkId: execution.referenceId };
  }

  return next;
}

export { stamp };
