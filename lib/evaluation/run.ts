import { SEED_CASES } from "../seed/cases";
import { generateSyntheticCases } from "../seed/synthetic";
import type { EvaluationReport, PolicyConfig, SeedCase } from "../types";
import { baselineRecommendPlay } from "../agent/recommend";
import { simulateStrategy } from "./simulate";
import { policyNow } from "../policy/defaults";
import { diagnose } from "../engine/diagnose";
import { recommendRecovery } from "../agent/recommend";

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
  const actionCount = rows.filter((r) => r.actionTaken).length;
  const byLeak = {} as EvaluationReport["baseline"]["byLeak"];
  for (const leak of [
    "payment_failure",
    "abandoned_checkout",
    "failed_subscription",
    "overdue_invoice",
  ] as const) {
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
    promisedCount: rows.filter((r) => r.status === "promised").length,
    actionsPerRecovery: recoveredCount ? actionCount / recoveredCount : 0,
    byLeak,
  };
}

export async function runEvaluation(opts: EvaluationOptions): Promise<EvaluationReport> {
  const cases: SeedCase[] =
    opts.dataset === "seed" ? SEED_CASES : generateSyntheticCases(opts.syntheticCount ?? 800);
  const now = policyNow(opts.policy);

  const baselineResults: ReturnType<typeof simulateStrategy>[] = [];
  const agentResults: ReturnType<typeof simulateStrategy>[] = [];

  for (const seed of cases) {
    const dx = diagnose(seed);
    const baselinePlay = baselineRecommendPlay(seed, dx);
    baselineResults.push(simulateStrategy(seed, baselinePlay, opts.policy, now, "baseline", dx.rootCause));

    const { agent } = await recommendRecovery(seed, { forceHeuristic: true });
    agentResults.push(
      simulateStrategy(seed, agent.recommendedPlay, opts.policy, now, "recoverai_agent", agent.rootCause),
    );
  }

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
