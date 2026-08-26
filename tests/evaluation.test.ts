import assert from "node:assert/strict";
import { test } from "node:test";
import { gatherCaseContext } from "../lib/agent/context";
import { diagnose } from "../lib/engine/diagnose";
import { groundTruthProbability, pairedLatent, settleAgainstGroundTruth } from "../lib/engine/groundTruth";
import { runEvaluation } from "../lib/evaluation/run";
import { pickBaselinePlay, simulateStrategy } from "../lib/evaluation/simulate";
import { recommendRecoveryHeuristic } from "../lib/agent/recommend";
import { DEFAULT_POLICY, policyNow } from "../lib/policy/defaults";
import { generateSyntheticCases } from "../lib/seed/synthetic";

test("baseline and RecoverAI use the same latent seed", () => {
  const seed = generateSyntheticCases(1)[0]!;
  const cause = diagnose(seed).rootCause;
  const latent = pairedLatent(seed);
  const baselinePlay = pickBaselinePlay(seed, cause);
  const policyPlay = recommendRecoveryHeuristic(seed, DEFAULT_POLICY).agent.recommendedPlay;
  const pBase = groundTruthProbability(seed, cause, baselinePlay);
  const pPolicy = groundTruthProbability(seed, cause, policyPlay);
  assert.equal(settleAgainstGroundTruth(seed, cause, baselinePlay), latent < pBase);
  assert.equal(settleAgainstGroundTruth(seed, cause, policyPlay), latent < pPolicy);
  assert.equal(pairedLatent(seed), latent);
});

test("paired evaluation is reproducible", async () => {
  const a = await runEvaluation({ dataset: "synthetic", syntheticCount: 120, policy: DEFAULT_POLICY });
  const b = await runEvaluation({ dataset: "synthetic", syntheticCount: 120, policy: DEFAULT_POLICY });
  assert.equal(a.llmCalls, 0);
  assert.equal(a.decisionMode, "recoverai_policy");
  assert.equal(a.paired, true);
  assert.equal(a.baseline.recoveredInr, b.baseline.recoveredInr);
  assert.equal(a.policy.recoveredInr, b.policy.recoveredInr);
  assert.equal(a.incrementalRecoveredInr, a.policy.recoveredInr - a.baseline.recoveredInr);
});

test("groundTruthProbability is hidden from the agent", () => {
  const seed = generateSyntheticCases(5)[0]!;
  const ctx = gatherCaseContext(seed);
  assert.ok(seed.groundTruthPropensity !== undefined);
  assert.ok(seed.latentOutcomeSeed !== undefined);
  assert.equal(JSON.stringify(ctx).includes("groundTruth"), false);
  assert.equal(JSON.stringify(ctx).includes("latentOutcome"), false);
});

test("baseline and RecoverAI outcomes are calculated from the same cases", () => {
  const cases = generateSyntheticCases(40);
  const now = policyNow(DEFAULT_POLICY);
  const pickPolicy = (current: (typeof cases)[0]) =>
    recommendRecoveryHeuristic(current, DEFAULT_POLICY).agent.recommendedPlay;
  for (const seed of cases) {
    const base = simulateStrategy(seed, pickBaselinePlay, DEFAULT_POLICY, now);
    const pol = simulateStrategy(seed, pickPolicy, DEFAULT_POLICY, now);
    assert.equal(base.leakType, pol.leakType);
    assert.equal(base.exposureInr, pol.exposureInr);
    assert.equal(base.exposureInr, seed.amountInr);
    if (base.actualRecovered) assert.equal(base.recoveredInr, seed.amountInr);
    if (!base.actualRecovered) assert.equal(base.recoveredInr, 0);
  }
});

test("evaluation metrics are calculated, not hardcoded", async () => {
  const small = await runEvaluation({ dataset: "synthetic", syntheticCount: 100, policy: DEFAULT_POLICY });
  const large = await runEvaluation({ dataset: "synthetic", syntheticCount: 250, policy: DEFAULT_POLICY });
  assert.equal(small.caseCount, 100);
  assert.equal(large.caseCount, 250);
  assert.notEqual(small.baseline.exposureInr, large.baseline.exposureInr);
  assert.ok(small.calibration.length === 5);
  assert.ok(Number.isFinite(small.brierScore));
  assert.equal(small.llmCalls, 0);
});
