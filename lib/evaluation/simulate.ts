import { sandboxUnit, recoveryProbability } from "../engine/execute";
import { evaluatePolicy } from "../engine/policy";
import { diagnose } from "../engine/diagnose";
import type { CaseStatus, LeakType, PlayId, PolicyConfig, RootCause, SeedCase } from "../types";

export type SimRow = {
  leakType: LeakType;
  exposureInr: number;
  recoveredInr: number;
  status: CaseStatus;
  actionTaken: boolean;
  playId: PlayId;
};

export function simulateStrategy(
  seed: SeedCase,
  playId: PlayId,
  policy: PolicyConfig,
  at: Date,
  _strategy: "baseline" | "recoverai_agent",
  rootCause?: RootCause,
): SimRow {
  const cause = rootCause ?? diagnose(seed).rootCause;
  const verdict = evaluatePolicy(seed, policy, at);

  if (verdict.action === "stop") {
    return {
      leakType: seed.leakType,
      exposureInr: seed.amountInr,
      recoveredInr: 0,
      status: "stopped",
      actionTaken: false,
      playId: "stop",
    };
  }
  if (verdict.action === "hold") {
    return {
      leakType: seed.leakType,
      exposureInr: seed.amountInr,
      recoveredInr: 0,
      status: verdict.ruleId === "promise-to-pay" ? "promised" : "held",
      actionTaken: false,
      playId: "stop",
    };
  }
  if (verdict.action === "escalate") {
    return {
      leakType: seed.leakType,
      exposureInr: seed.amountInr,
      recoveredInr: 0,
      status: "escalated",
      actionTaken: true,
      playId: "human_escalate",
    };
  }

  let effectivePlay = playId;
  if (effectivePlay === "stop" || effectivePlay === "human_escalate") {
    return {
      leakType: seed.leakType,
      exposureInr: seed.amountInr,
      recoveredInr: 0,
      status: effectivePlay === "human_escalate" ? "escalated" : "stopped",
      actionTaken: effectivePlay !== "stop",
      playId: effectivePlay,
    };
  }

  if (effectivePlay === "promise_to_pay") {
    return {
      leakType: seed.leakType,
      exposureInr: seed.amountInr,
      recoveredInr: 0,
      status: "promised",
      actionTaken: true,
      playId: effectivePlay,
    };
  }

  const hist =
    seed.signals.paymentSuccessRate ??
    0.55 + sandboxUnit(seed.id, "hist") * 0.4;
  const p = recoveryProbability(cause, effectivePlay) * (0.7 + hist * 0.35);
  const roll = sandboxUnit(seed.id, `${effectivePlay}-sim`);
  const settled = roll < p;

  return {
    leakType: seed.leakType,
    exposureInr: seed.amountInr,
    recoveredInr: settled ? seed.amountInr : 0,
    status: settled ? "recovered" : "at_risk",
    actionTaken: true,
    playId: effectivePlay,
  };
}
