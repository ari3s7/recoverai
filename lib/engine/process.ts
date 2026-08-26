import { inr, CAUSE_LABEL } from "../format";
import { uid } from "../ids";
import { recommendRecovery } from "../agent/recommend";
import { resolvePlayAfterPolicy } from "../agent/validate";
import type {
  AuditEvent,
  CaseStatus,
  Outcome,
  Play,
  PolicyConfig,
  RunCase,
} from "../types";
import { executePlay } from "./execute";
import { evaluatePolicy } from "./policy";
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

  timeline.push(
    stamp(current.id, "agent", "detect", `${current.leakType} · ${inr(current.amountInr)} at risk`),
  );

  const { diagnosis, agent } = await recommendRecovery(current);
  timeline.push(
    stamp(
      current.id,
      "ai",
      "recommend",
      `${agent.recommendedPlay} · est ${Math.round(agent.recoveryProbability * 100)}% recovery · ${agent.provider}`,
    ),
  );
  timeline.push(
    stamp(
      current.id,
      "ai",
      "diagnose",
      `${CAUSE_LABEL[agent.rootCause]} (${agent.confidence}% confidence)`,
    ),
  );

  const verdict = evaluatePolicy(current, policy, now);
  timeline.push(stamp(current.id, "policy", verdict.ruleId ?? verdict.action, verdict.reason));

  const ruleFallback = selectPlay(current, diagnosis, verdict);
  const playId = resolvePlayAfterPolicy(agent, verdict, ruleFallback.id);
  const play = buildPlayForId(
    current,
    agent.rootCause,
    playId,
    `AI recommended ${agent.recommendedPlay}. Policy resolved to ${playId}. ${agent.reasoning[0] ?? ""}`,
  );
  if (playId !== agent.recommendedPlay && verdict.action === "proceed") {
    timeline.push(
      stamp(
        current.id,
        "policy",
        "play-clamp",
        `Agent suggested ${agent.recommendedPlay}; executing ${playId} after policy merge.`,
      ),
    );
  }
  timeline.push(stamp(current.id, "agent", `play:${play.id}`, play.reason));

  const execution = await executePlay(current, play, agent.rootCause);

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
  } else if (!policy.autoExecute && play.id !== "stop") {
    status = "escalated";
    outcome = {
      status: "escalated",
      recoveredInr: 0,
      promisedInr: 0,
      note: "Auto-execute is off. Play is queued for operator approval.",
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

  timeline.push(
    stamp(
      current.id,
      execution.provider === "operator" ? "human" : "agent",
      "execute",
      execution.message,
      outcome.recoveredInr || undefined,
    ),
  );

  if (outcome.recoveredInr > 0) {
    timeline.push(
      stamp(
        current.id,
        execution.provider === "razorpay" ? "ingest" : "agent",
        "outcome.settled",
        execution.provider === "razorpay"
          ? `Razorpay verified capture · ${inr(outcome.recoveredInr)}`
          : `Sandbox simulation settled · ${inr(outcome.recoveredInr)} (not live money)`,
        outcome.recoveredInr,
      ),
    );
  }

  const next: RunCase = bumpContacts(
    {
      ...current,
      status,
      diagnosis,
      agent,
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
