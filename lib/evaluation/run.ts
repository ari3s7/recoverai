import { gatherCaseContext } from "../agent/context";
import { recommendRecoveryHeuristic } from "../agent/recommend";
import { calculateRecoveryScore } from "../agent/score";
import { policyNow } from "../policy/defaults";
import { SEED_CASES } from "../seed/cases";
import { generateSyntheticCases } from "../seed/synthetic";
import {
  LEAK_TYPES,
  type CalibrationBucket,
  type EvaluationReport,
  type PlayId,
  type PolicyConfig,
  type RootCause,
  type SeedCase,
} from "../types";
import { pickBaselinePlay, simulateStrategy, type SimRow } from "./simulate";

export type EvaluationOptions = {
  dataset: "seed" | "synthetic";
  syntheticCount?: number;
  policy: PolicyConfig;
};

const BUCKETS = [
  { label: "0–20%", lo: 0, hi: 0.2 },
  { label: "20–40%", lo: 0.2, hi: 0.4 },
  { label: "40–60%", lo: 0.4, hi: 0.6 },
  { label: "60–80%", lo: 0.6, hi: 0.8 },
  { label: "80–100%", lo: 0.8, hi: 1.0001 },
];

function mergeMetrics(rows: SimRow[], strategy: "baseline" | "recoverai_policy"): EvaluationReport["baseline"] {
  const exposureInr = rows.reduce((s, r) => s + r.exposureInr, 0);
  const recoveredInr = rows.reduce((s, r) => s + r.recoveredInr, 0);
  const recoveredCount = rows.filter((r) => r.actualRecovered).length;
  const actionCount = rows.reduce((s, r) => s + r.actionCount, 0);
  const scored = rows.filter((r) => r.playId !== "stop" && r.playId !== "human_escalate" && r.actionCount > 0);
  const avgPredictedProbability = scored.length
    ? scored.reduce((s, r) => s + r.predictedProbability, 0) / scored.length
    : 0;
  const byLeak = {} as EvaluationReport["baseline"]["byLeak"];
  for (const leak of LEAK_TYPES) {
    const subset = rows.filter((r) => r.leakType === leak);
    byLeak[leak] = {
      count: subset.length,
      exposureInr: subset.reduce((s, r) => s + r.exposureInr, 0),
      recoveredInr: subset.reduce((s, r) => s + r.recoveredInr, 0),
    };
  }
  return {
    strategy,
    exposureInr,
    recoveredInr,
    recoveryRate: exposureInr ? recoveredInr / exposureInr : 0,
    actionCount,
    recoveredCount,
    escalatedCount: rows.filter((r) => r.status === "escalated").length,
    stoppedCount: rows.filter((r) => r.status === "stopped").length,
    promisedCount: rows.filter((r) => r.promised).length,
    promisedFulfilledCount: rows.filter((r) => r.promisedFulfilled).length,
    actionsPerRecovery: recoveredCount ? actionCount / recoveredCount : 0,
    avgPredictedProbability,
    byLeak,
  };
}

function calibrationOf(rows: SimRow[]): { buckets: CalibrationBucket[]; brierScore: number } {
  const scored = rows.filter((r) => r.actionCount > 0 && r.playId !== "stop" && r.playId !== "human_escalate");
  const buckets: CalibrationBucket[] = BUCKETS.map(({ label, lo, hi }) => {
    const subset = scored.filter((r) => r.predictedProbability >= lo && r.predictedProbability < hi);
    const actuals = subset.filter((r) => r.actualRecovered).length;
    return {
      bucket: label,
      count: subset.length,
      avgPredicted: subset.length
        ? subset.reduce((s, r) => s + r.predictedProbability, 0) / subset.length
        : 0,
      actualRecoveryRate: subset.length ? actuals / subset.length : 0,
    };
  });
  const brierScore = scored.length
    ? scored.reduce((s, r) => s + (r.predictedProbability - (r.actualRecovered ? 1 : 0)) ** 2, 0) / scored.length
    : 0;
  return { buckets, brierScore };
}

export async function runEvaluation(opts: EvaluationOptions): Promise<EvaluationReport> {
  const cases: SeedCase[] =
    opts.dataset === "seed" ? SEED_CASES : generateSyntheticCases(opts.syntheticCount ?? 2000);
  const now = policyNow(opts.policy);

  const pickPolicyPlay = (current: SeedCase) =>
    recommendRecoveryHeuristic(current, opts.policy).agent.recommendedPlay;

  const predict = (current: SeedCase, playId: PlayId, cause: RootCause) => {
    if (playId === "stop" || playId === "human_escalate") return 0;
    return calculateRecoveryScore(gatherCaseContext(current), cause, playId);
  };

  const baselineResults = cases.map((seed) =>
    simulateStrategy(seed, pickBaselinePlay, opts.policy, now, predict),
  );
  const policyResults = cases.map((seed) =>
    simulateStrategy(seed, pickPolicyPlay, opts.policy, now, predict),
  );

  const baseline = mergeMetrics(baselineResults, "baseline");
  const policy = mergeMetrics(policyResults, "recoverai_policy");
  const incrementalRecoveredInr = policy.recoveredInr - baseline.recoveredInr;
  const recoveryLiftPct = baseline.recoveredInr
    ? (incrementalRecoveredInr / baseline.recoveredInr) * 100
    : policy.recoveredInr > 0
      ? 100
      : 0;
  const recoveryRateLiftPct = baseline.recoveryRate
    ? ((policy.recoveryRate - baseline.recoveryRate) / baseline.recoveryRate) * 100
    : policy.recoveryRate > 0
      ? 100
      : 0;
  const { buckets, brierScore } = calibrationOf(policyResults);

  return {
    caseCount: cases.length,
    baseline,
    policy,
    incrementalRecoveredInr,
    recoveryLiftPct,
    recoveryRateLiftPct,
    actionEfficiencyDelta: policy.actionsPerRecovery - baseline.actionsPerRecovery,
    escalationDelta: policy.escalatedCount - baseline.escalatedCount,
    dataset: opts.dataset,
    ranAt: new Date().toISOString(),
    decisionMode: "recoverai_policy",
    llmCalls: 0,
    paired: true,
    calibration: buckets,
    brierScore,
  };
}
