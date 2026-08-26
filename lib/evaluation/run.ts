import { recommendRecoveryHeuristic } from "../agent/recommend";
import { SEED_CASES } from "../seed/cases";
import { generateSyntheticCases } from "../seed/synthetic";
import { LEAK_TYPES, type EvaluationReport, type PolicyConfig, type SeedCase } from "../types";
import { pickBaselinePlay, simulateStrategy } from "./simulate";
import { policyNow } from "../policy/defaults";

export type EvaluationOptions = {
  dataset: "seed" | "synthetic";
  syntheticCount?: number;
  policy: PolicyConfig;
};

function mergeMetrics(
  rows: ReturnType<typeof simulateStrategy>[],
  strategy: "baseline" | "recoverai_agent",
): EvaluationReport["baseline"] {
  const exposureInr = rows.reduce((s, r) => s + r.exposureInr, 0);
  const recoveredInr = rows.reduce((s, r) => s + r.recoveredInr, 0);
  const recoveredCount = rows.filter((r) => r.recoveredInr > 0).length;
  const actionCount = rows.reduce((s, r) => s + r.actionCount, 0);
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
    byLeak,
  };
}

export async function runEvaluation(opts: EvaluationOptions): Promise<EvaluationReport> {
  const cases: SeedCase[] =
    opts.dataset === "seed" ? SEED_CASES : generateSyntheticCases(opts.syntheticCount ?? 2000);
  const now = policyNow(opts.policy);
  const pickAgentPlay = (current: SeedCase) =>
    recommendRecoveryHeuristic(current, opts.policy).agent.recommendedPlay;

  const baselineResults = cases.map((seed) =>
    simulateStrategy(seed, pickBaselinePlay, opts.policy, now),
  );
  const agentResults = cases.map((seed) =>
    simulateStrategy(seed, pickAgentPlay, opts.policy, now),
  );

  const baseline = mergeMetrics(baselineResults, "baseline");
  const agent = mergeMetrics(agentResults, "recoverai_agent");
  const incrementalRecoveredInr = agent.recoveredInr - baseline.recoveredInr;
  const recoveryLiftPct = baseline.recoveredInr
    ? (incrementalRecoveredInr / baseline.recoveredInr) * 100
    : agent.recoveredInr > 0
      ? 100
      : 0;

  return {
    caseCount: cases.length,
    baseline,
    agent,
    incrementalRecoveredInr,
    recoveryLiftPct,
    dataset: opts.dataset,
    ranAt: new Date().toISOString(),
  };
}
