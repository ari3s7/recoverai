import { baselineRecommendPlay } from "../engine/baseline";
import { diagnose } from "../engine/diagnose";
import { clampPlayToPolicy, evaluatePolicy } from "../engine/policy";
import { settleAgainstGroundTruth } from "../engine/groundTruth";
import type { CaseStatus, LeakType, PlayId, PolicyConfig, RootCause, SeedCase } from "../types";

export type SimRow = {
  leakType: LeakType;
  exposureInr: number;
  recoveredInr: number;
  status: CaseStatus;
  actionTaken: boolean;
  actionCount: number;
  playId: PlayId;
  promised: boolean;
  promisedFulfilled: boolean;
};

function cloneSeed(seed: SeedCase): SeedCase {
  return {
    ...seed,
    signals: { ...seed.signals, flags: [...seed.signals.flags] },
  };
}

function bump(working: SeedCase, playId: PlayId, nowIso: string) {
  if (playId !== "smart_retry" && playId !== "payment_link" && playId !== "hinglish_voice") return;
  working.signals.contactsLast7Days += 1;
  working.signals.lastContactAt = nowIso;
  if (playId === "smart_retry") {
    working.signals.retryCount += 1;
    working.signals.mandateRetryCount = (working.signals.mandateRetryCount ?? 0) + 1;
    working.signals.lastRetryAt = nowIso;
  }
}

export function simulateStrategy(
  seed: SeedCase,
  pickPlay: (current: SeedCase, cause: RootCause) => PlayId,
  policy: PolicyConfig,
  at: Date,
): SimRow {
  const working = cloneSeed(seed);
  const nowIso = at.toISOString();
  let actionCount = 0;
  let lastPlay: PlayId = "stop";
  let promised = false;

  for (let step = 0; step < 3; step++) {
    const cause = diagnose(working).rootCause;
    const verdict = evaluatePolicy(working, policy, at);

    if (verdict.action === "stop") {
      return {
        leakType: seed.leakType,
        exposureInr: seed.amountInr,
        recoveredInr: 0,
        status: "stopped",
        actionTaken: actionCount > 0,
        actionCount,
        playId: lastPlay,
        promised,
        promisedFulfilled: false,
      };
    }
    if (verdict.action === "hold") {
      const isPtp = verdict.ruleId === "promise-to-pay";
      return {
        leakType: seed.leakType,
        exposureInr: seed.amountInr,
        recoveredInr: 0,
        status: isPtp ? "promised" : "held",
        actionTaken: actionCount > 0,
        actionCount,
        playId: lastPlay,
        promised: isPtp,
        promisedFulfilled: false,
      };
    }
    if (verdict.action === "escalate") {
      return {
        leakType: seed.leakType,
        exposureInr: seed.amountInr,
        recoveredInr: 0,
        status: "escalated",
        actionTaken: true,
        actionCount: actionCount + 1,
        playId: "human_escalate",
        promised,
        promisedFulfilled: false,
      };
    }

    const raw = pickPlay(working, cause);
    const playId = clampPlayToPolicy(raw, working, policy, verdict, at);
    lastPlay = playId;

    if (playId === "stop") {
      return {
        leakType: seed.leakType,
        exposureInr: seed.amountInr,
        recoveredInr: 0,
        status: "stopped",
        actionTaken: actionCount > 0,
        actionCount,
        playId,
        promised,
        promisedFulfilled: false,
      };
    }
    if (playId === "human_escalate") {
      return {
        leakType: seed.leakType,
        exposureInr: seed.amountInr,
        recoveredInr: 0,
        status: "escalated",
        actionTaken: true,
        actionCount: actionCount + 1,
        playId,
        promised,
        promisedFulfilled: false,
      };
    }

    actionCount += 1;

    if (playId === "promise_to_pay") {
      promised = true;
      const fulfilled = settleAgainstGroundTruth(working, cause, "promise_to_pay", `ptp-${step}`);
      return {
        leakType: seed.leakType,
        exposureInr: seed.amountInr,
        recoveredInr: fulfilled ? seed.amountInr : 0,
        status: fulfilled ? "recovered" : "promised",
        actionTaken: true,
        actionCount,
        playId,
        promised: true,
        promisedFulfilled: fulfilled,
      };
    }

    const settled = settleAgainstGroundTruth(working, cause, playId, `${playId}-sim-${step}`);
    if (settled) {
      return {
        leakType: seed.leakType,
        exposureInr: seed.amountInr,
        recoveredInr: seed.amountInr,
        status: "recovered",
        actionTaken: true,
        actionCount,
        playId,
        promised,
        promisedFulfilled: false,
      };
    }

    bump(working, playId, nowIso);
    if (playId !== "smart_retry") break;
  }

  return {
    leakType: seed.leakType,
    exposureInr: seed.amountInr,
    recoveredInr: 0,
    status: "at_risk",
    actionTaken: actionCount > 0,
    actionCount,
    playId: lastPlay,
    promised,
    promisedFulfilled: false,
  };
}

export function pickBaselinePlay(current: SeedCase, cause?: RootCause): PlayId {
  const dx = cause
    ? { rootCause: cause, label: cause, confidence: 0, evidence: [], narrative: "" }
    : diagnose(current);
  return baselineRecommendPlay(current, dx);
}
