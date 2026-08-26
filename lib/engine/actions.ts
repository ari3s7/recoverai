import { inr } from "../format";
import { policyNow } from "../policy/defaults";
import type { CaseActionRequest, PolicyConfig, RunCase } from "../types";
import { stamp, processCase } from "./process";

export function applyOperatorAction(
  current: RunCase,
  action: CaseActionRequest,
  policy: PolicyConfig,
): RunCase {
  const now = policyNow(policy);
  const ts = now.toISOString();

  if (action.type === "run") {
    return processCase({ ...current, lastBatchId: undefined }, policy, now);
  }

  if (action.type === "stop") {
    const event = stamp(current.id, "human", "operator.stop", action.reason);
    return {
      ...current,
      status: "stopped",
      outcome: { status: "stopped", recoveredInr: 0, promisedInr: 0, note: action.reason },
      execution: {
        ok: true,
        provider: "operator",
        referenceId: event.id,
        message: action.reason,
      },
      timeline: [...current.timeline, event],
      updatedAt: ts,
    };
  }

  if (action.type === "escalate") {
    const event = stamp(current.id, "human", "operator.escalate", action.reason);
    return {
      ...current,
      status: "escalated",
      outcome: { status: "escalated", recoveredInr: 0, promisedInr: 0, note: action.reason },
      play: {
        id: "human_escalate",
        label: "Human escalate",
        channel: "operator",
        reason: action.reason,
      },
      timeline: [...current.timeline, event],
      updatedAt: ts,
    };
  }

  if (action.type === "mark_recovered") {
    const amount = action.amountInr ?? current.amountInr;
    const note = action.note ?? `Operator recorded recovery of ${inr(amount)}.`;
    const event = stamp(current.id, "human", "operator.recover", note, amount);
    return {
      ...current,
      status: "recovered",
      outcome: { status: "recovered", recoveredInr: amount, promisedInr: 0, note },
      execution: {
        ok: true,
        provider: "operator",
        referenceId: event.id,
        message: note,
      },
      signals: { ...current.signals, promiseToPayDate: undefined },
      operatorNote: action.note,
      timeline: [...current.timeline, event],
      updatedAt: ts,
    };
  }

  if (action.type === "capture_promise") {
    const amount = action.amountInr ?? current.amountInr;
    const note = action.note ?? `Promise-to-pay ${action.date} for ${inr(amount)}.`;
    const event = stamp(current.id, "human", "operator.promise", note);
    return {
      ...current,
      status: "promised",
      outcome: {
        status: "promised",
        recoveredInr: 0,
        promisedInr: amount,
        promisedDate: action.date,
        note,
      },
      play: {
        id: "promise_to_pay",
        label: "Promise-to-pay",
        channel: "operator",
        reason: note,
      },
      signals: { ...current.signals, promiseToPayDate: action.date },
      operatorNote: action.note,
      timeline: [...current.timeline, event],
      updatedAt: ts,
    };
  }

  const event = stamp(current.id, "human", "operator.release", "Hold released. Case returned to at-risk.");
  return {
    ...current,
    status: "at_risk",
    lastBatchId: undefined,
    outcome: { status: "at_risk", recoveredInr: 0, promisedInr: 0, note: "Hold released." },
    signals: { ...current.signals, promiseToPayDate: undefined },
    timeline: [...current.timeline, event],
    updatedAt: ts,
  };
}
