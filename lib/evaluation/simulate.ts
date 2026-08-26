import { baselineRecommendPlay } from "../engine/baseline";
import { diagnose } from "../engine/diagnose";
import { clampPlayToPolicy, evaluatePolicy } from "../engine/policy";
import { groundTruthProbability, settleAgainstGroundTruth } from "../engine/groundTruth";
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
  predictedProbability: number;
  groundTruthProbability: number;
  actualRecovered: boolean;
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

function row(
  seed: SeedCase,
  partial: Omit<SimRow, "leakType" | "exposureInr">,
): SimRow {
  return {
    leakType: seed.leakType,
    exposureInr: seed.amountInr,
    ...partial,
  };
}

export function simulateStrategy(
  seed: SeedCase,
  pickPlay: (current: SeedCase, cause: RootCause) => PlayId,
  policy: PolicyConfig,
  at: Date,
  predict?: (current: SeedCase, playId: PlayId, cause: RootCause) => number,
): SimRow {
  const working = cloneSeed(seed);
  const nowIso = at.toISOString();
  let actionCount = 0;
  let lastPlay: PlayId = "stop";
  let promised = false;
  let lastPredicted = 0;
  let lastTruth = 0;

  const empty = (
    status: CaseStatus,
    extra: Partial<SimRow> & { playId: PlayId; actionCount: number },
  ): SimRow =>
    row(seed, {
      recoveredInr: 0,
      status,
      actionTaken: extra.actionCount > 0 || extra.playId === "human_escalate",
      promised,
      promisedFulfilled: false,
      predictedProbability: lastPredicted,
      groundTruthProbability: lastTruth,
      actualRecovered: false,
      ...extra,
    });

  for (let step = 0; step < 3; step++) {
    const cause = diagnose(working).rootCause;
    const verdict = evaluatePolicy(working, policy, at);

    if (verdict.action === "stop") {
      return empty("stopped", { playId: lastPlay, actionCount, actionTaken: actionCount > 0 });
    }
    if (verdict.action === "hold") {
      const isPtp = verdict.ruleId === "promise-to-pay";
      return empty(isPtp ? "promised" : "held", {
        playId: lastPlay,
        actionCount,
        actionTaken: actionCount > 0,
        promised: isPtp || promised,
      });
    }
    if (verdict.action === "escalate") {
      return empty("escalated", {
        playId: "human_escalate",
        actionCount: actionCount + 1,
        actionTaken: true,
      });
    }

    const raw = pickPlay(working, cause);
    const playId = clampPlayToPolicy(raw, working, policy, verdict, at);
    lastPlay = playId;
    lastPredicted = predict?.(working, playId, cause) ?? 0;
    lastTruth = groundTruthProbability(working, cause, playId);

    if (playId === "stop") {
      return empty("stopped", { playId, actionCount, actionTaken: actionCount > 0 });
    }
    if (playId === "human_escalate") {
      return empty("escalated", {
        playId,
        actionCount: actionCount + 1,
        actionTaken: true,
      });
    }

    actionCount += 1;

    if (playId === "promise_to_pay") {
      promised = true;
      const fulfilled = settleAgainstGroundTruth(working, cause, "promise_to_pay");
      return row(seed, {
        recoveredInr: fulfilled ? seed.amountInr : 0,
        status: fulfilled ? "recovered" : "promised",
        actionTaken: true,
        actionCount,
        playId,
        promised: true,
        promisedFulfilled: fulfilled,
        predictedProbability: lastPredicted,
        groundTruthProbability: lastTruth,
        actualRecovered: fulfilled,
      });
    }

    const settled = settleAgainstGroundTruth(working, cause, playId);
    if (settled) {
      return row(seed, {
        recoveredInr: seed.amountInr,
        status: "recovered",
        actionTaken: true,
        actionCount,
        playId,
        promised,
        promisedFulfilled: false,
        predictedProbability: lastPredicted,
        groundTruthProbability: lastTruth,
        actualRecovered: true,
      });
    }

    bump(working, playId, nowIso);
    if (playId !== "smart_retry") break;
  }

  return empty("at_risk", {
    playId: lastPlay,
    actionCount,
    actionTaken: actionCount > 0,
  });
}

export function pickBaselinePlay(current: SeedCase, cause?: RootCause): PlayId {
  const dx = cause
    ? { rootCause: cause, label: cause, confidence: 0, evidence: [], narrative: "" }
    : diagnose(current);
  return baselineRecommendPlay(current, dx);
}
