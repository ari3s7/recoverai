import type { LeakType, PlayId, RunCase } from "../types";
import { LEAK_TYPES } from "../types";
import { computeTotals } from "./totals";
import { describePromiseLifecycle } from "./promise";

const PLAYS: PlayId[] = [
  "smart_retry",
  "payment_link",
  "hinglish_voice",
  "promise_to_pay",
  "human_escalate",
  "stop",
];

export type BucketStats = {
  count: number;
  recoveredCount: number;
  recoveredInr: number;
  exposureInr: number;
};

export type DeskAnalytics = {
  byPlay: Record<PlayId, BucketStats>;
  byLeak: Record<LeakType, BucketStats>;
  outboundActionCount: number;
  recoveredCount: number;
  actionsPerRecovery: number;
  stoppedCount: number;
  escalatedCount: number;
  promisesCreated: number;
  promisesFulfilled: number;
  promisesBroken: number;
  recoveryRate: number;
  verifiedRecoveredInr: number;
};

export type RecoveryForecast = {
  revenueAtRisk: number;
  predictedRecoverableInr: number | null;
  verifiedRecoveredInr: number;
  highConfidenceOpenCount: number;
  scoredOpenCount: number;
};

function emptyBucket(): BucketStats {
  return { count: 0, recoveredCount: 0, recoveredInr: 0, exposureInr: 0 };
}

function isVerifiedRecovered(cse: RunCase): boolean {
  return cse.status === "recovered" && (cse.outcome?.recoveredInr ?? 0) > 0;
}

function recoveryPlay(cse: RunCase): PlayId | undefined {
  if (cse.play?.id) return cse.play.id;
  return cse.agent?.recommendedPlay;
}

export function computeDeskAnalytics(cases: RunCase[], at = new Date()): DeskAnalytics {
  const totals = computeTotals(cases);
  const byPlay = Object.fromEntries(PLAYS.map((p) => [p, emptyBucket()])) as Record<PlayId, BucketStats>;
  const byLeak = Object.fromEntries(LEAK_TYPES.map((l) => [l, emptyBucket()])) as Record<
    LeakType,
    BucketStats
  >;

  for (const cse of cases) {
    const leak = byLeak[cse.leakType];
    leak.count += 1;
    leak.exposureInr += cse.amountInr;
    if (isVerifiedRecovered(cse)) {
      leak.recoveredCount += 1;
      leak.recoveredInr += cse.outcome?.recoveredInr ?? 0;
    }
    const play = recoveryPlay(cse);
    if (play) {
      const bucket = byPlay[play];
      bucket.count += 1;
      bucket.exposureInr += cse.amountInr;
      if (isVerifiedRecovered(cse)) {
        bucket.recoveredCount += 1;
        bucket.recoveredInr += cse.outcome?.recoveredInr ?? 0;
      }
    }
  }

  const outboundActionCount = cases.reduce(
    (n, cse) => n + cse.timeline.filter((e) => e.action === "ACTION_EXECUTED").length,
    0,
  );
  const recoveredCount = totals.recoveredCount;
  let promisesCreated = 0;
  let promisesFulfilled = 0;
  let promisesBroken = 0;
  for (const cse of cases) {
    const life = describePromiseLifecycle(cse, at);
    if (life.state === "none") continue;
    promisesCreated += 1;
    if (life.state === "fulfilled") promisesFulfilled += 1;
    if (life.state === "broken") promisesBroken += 1;
  }

  return {
    byPlay,
    byLeak,
    outboundActionCount,
    recoveredCount,
    actionsPerRecovery: recoveredCount ? outboundActionCount / recoveredCount : 0,
    stoppedCount: totals.stoppedCount,
    escalatedCount: totals.escalatedCount,
    promisesCreated,
    promisesFulfilled,
    promisesBroken,
    recoveryRate: totals.recoveryRate,
    verifiedRecoveredInr: totals.recoveredInr,
  };
}

/**
 * Forecast from live desk state only.
 * Predicted recoverable = sum(amount × AI predicted P) on open scored cases.
 * Not an ML forecast and not verified money.
 */
export function computeRecoveryForecast(cases: RunCase[]): RecoveryForecast {
  const totals = computeTotals(cases);
  const open = cases.filter((c) => c.status !== "recovered" && c.status !== "stopped");
  const scored = open.filter((c) => c.agent && typeof c.agent.aiPredictedRecoveryProbability === "number");
  const predictedRecoverableInr = scored.length
    ? Math.round(
        scored.reduce(
          (s, c) => s + c.amountInr * (c.agent!.aiPredictedRecoveryProbability ?? c.agent!.recoveryProbability),
          0,
        ),
      )
    : null;
  const highConfidenceOpenCount = scored.filter((c) => c.agent!.confidence >= 80).length;
  return {
    revenueAtRisk: totals.stillAtRiskInr,
    predictedRecoverableInr,
    verifiedRecoveredInr: totals.recoveredInr,
    highConfidenceOpenCount,
    scoredOpenCount: scored.length,
  };
}
