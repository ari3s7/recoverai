import assert from "node:assert/strict";
import { test } from "node:test";
import { gatherCaseContext } from "../lib/agent/context";
import { interpretCustomerIntent } from "../lib/agent/intent";
import {
  parseConfidencePercent,
  parseLlmRecommendation,
  parseProbability01,
  recommendRecovery,
  recommendRecoveryHeuristic,
} from "../lib/agent/recommend";
import { diagnose } from "../lib/engine/diagnose";
import { rankPlays } from "../lib/agent/score";
import { SEED_CASES } from "../lib/seed/cases";
import { generateSyntheticCases } from "../lib/seed/synthetic";

const seed = SEED_CASES[0]!;
const dx = diagnose(seed);
const ranked = rankPlays(gatherCaseContext(seed), dx.rootCause, seed);

test("valid structured LLM response is accepted", () => {
  const rec = parseLlmRecommendation(
    {
      rootCause: "insufficient_funds",
      recoveryProbability: 0.87,
      recommendedPlay: "payment_link",
      confidence: 0.91,
      reasoning: ["11 of 12 previous payments succeeded", "Current failure is isolated"],
    },
    seed,
    dx,
    ranked,
    "openai",
  );
  assert.ok(rec);
  assert.equal(rec.rootCause, "insufficient_funds");
  assert.equal(rec.recommendedPlay, "payment_link");
  assert.equal(rec.recoveryProbability, 0.87);
  assert.equal(rec.aiPredictedRecoveryProbability, 0.87);
  assert.equal(rec.confidence, 91);
});

test("invalid JSON fields fall back (parse returns null)", () => {
  assert.equal(
    parseLlmRecommendation({ recommendedPlay: "wire_transfer" }, seed, dx, ranked, "openai"),
    null,
  );
});

test("invalid play safely falls back to heuristic", async () => {
  const { agent } = await recommendRecovery(seed, { forceHeuristic: true });
  assert.equal(agent.provider, "heuristic");
  assert.ok(agent.recommendedPlay);
});

test("probability 0 remains 0", () => {
  assert.equal(parseProbability01(0), 0);
  const rec = parseLlmRecommendation(
    {
      rootCause: "insufficient_funds",
      recoveryProbability: 0,
      recommendedPlay: "stop",
      confidence: 0.5,
      reasoning: ["no conversion expected"],
    },
    seed,
    dx,
    ranked,
    "openai",
  );
  assert.equal(rec?.recoveryProbability, 0);
  assert.equal(rec?.aiPredictedRecoveryProbability, 0);
});

test("confidence 0 remains 0", () => {
  assert.equal(parseConfidencePercent(0), 0);
  const rec = parseLlmRecommendation(
    {
      rootCause: "insufficient_funds",
      recoveryProbability: 0.2,
      recommendedPlay: "payment_link",
      confidence: 0,
      reasoning: ["low confidence"],
    },
    seed,
    dx,
    ranked,
    "openai",
  );
  assert.equal(rec?.confidence, 0);
});

test("probability >1 is rejected", () => {
  assert.equal(parseProbability01(1.5), null);
  assert.equal(parseProbability01(150), null);
  const rec = parseLlmRecommendation(
    {
      rootCause: "insufficient_funds",
      recoveryProbability: 1.5,
      recommendedPlay: "payment_link",
      confidence: 0.9,
      reasoning: ["bad"],
    },
    seed,
    dx,
    ranked,
    "openai",
  );
  assert.equal(rec, null);
});

test("ground truth is never passed to AI context", () => {
  const syn = generateSyntheticCases(3);
  for (const cse of syn) {
    const ctx = gatherCaseContext(cse);
    const blob = JSON.stringify(ctx);
    assert.equal("groundTruthPropensity" in ctx, false);
    assert.equal("latentOutcomeSeed" in ctx, false);
    assert.equal(blob.includes("groundTruth"), false);
    assert.equal(blob.includes("latentOutcome"), false);
    assert.ok(ctx.customerHistory.lifetimePayments >= 0);
    assert.ok(typeof ctx.customerHistory.successfulPayments === "number");
  }
});

test("Hinglish link intent maps to payment_link", () => {
  const intent = interpretCustomerIntent("Bhai payment nahi ho raha, link bhej do.");
  assert.equal(intent?.play, "payment_link");
  assert.match(intent?.reply ?? "", /payment link/i);
});

test("heuristic recommendation stays inside the play enum", () => {
  const { agent, context } = recommendRecoveryHeuristic(seed);
  assert.ok(context.customerHistory);
  assert.notEqual(agent.recommendedPlay, undefined);
  assert.equal(agent.aiPredictedRecoveryProbability, agent.recoveryProbability);
});
