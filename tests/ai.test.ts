import assert from "node:assert/strict";
import { test } from "node:test";
import { gatherCaseContext } from "../lib/agent/context";
import { interpretCustomerIntent } from "../lib/agent/intent";
import {
  buildLiveAiPayload,
  extractJsonObject,
  parseConfidencePercent,
  parseLlmRecommendation,
  parseLlmRecommendationResult,
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

test("label-style rootCause and play from the model are normalized", () => {
  const rec = parseLlmRecommendation(
    {
      rootCause: "Insufficient funds",
      recoveryProbability: "67%",
      recommendedPlay: "Payment Link",
      confidence: "0.96",
      reasoning: "5 of 8 prior payments succeeded",
    },
    seed,
    dx,
    ranked,
    "gemini",
  );
  assert.ok(rec);
  assert.equal(rec.rootCause, "insufficient_funds");
  assert.equal(rec.recommendedPlay, "payment_link");
  assert.equal(rec.recoveryProbability, 0.67);
  assert.equal(rec.confidence, 96);
});

test("validator reports distinct rejection reasons", () => {
  const base = {
    rootCause: "insufficient_funds",
    recoveryProbability: 0.4,
    recommendedPlay: "payment_link",
    confidence: 0.5,
    reasoning: ["observable history"],
  };
  const cause = parseLlmRecommendationResult({ ...base, rootCause: "made_up" }, seed, dx, ranked, "openai");
  assert.equal(cause.ok, false);
  if (!cause.ok) assert.equal(cause.reason, "invalid_rootCause");
  const play = parseLlmRecommendationResult({ ...base, recommendedPlay: "wire_transfer" }, seed, dx, ranked, "openai");
  assert.equal(play.ok, false);
  if (!play.ok) assert.equal(play.reason, "invalid_recommendedPlay");
  const prob = parseLlmRecommendationResult({ ...base, recoveryProbability: 1.5 }, seed, dx, ranked, "openai");
  assert.equal(prob.ok, false);
  if (!prob.ok) assert.equal(prob.reason, "invalid_recoveryProbability");
  const conf = parseLlmRecommendationResult({ ...base, confidence: 140 }, seed, dx, ranked, "openai");
  assert.equal(conf.ok, false);
  if (!conf.ok) assert.equal(conf.reason, "invalid_confidence");
  const why = parseLlmRecommendationResult({ ...base, reasoning: [] }, seed, dx, ranked, "openai");
  assert.equal(why.ok, false);
  if (!why.ok) assert.equal(why.reason, "invalid_reasoning");
});

test("JSON extraction handles fences, empty text, and invalid JSON", () => {
  const empty = extractJsonObject("");
  assert.equal(empty.ok, false);
  if (!empty.ok) assert.equal(empty.reason, "empty_response");
  const missing = extractJsonObject("no json here");
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.equal(missing.reason, "json_extract_failed");
  const broken = extractJsonObject("{not json}");
  assert.equal(broken.ok, false);
  if (!broken.ok) assert.equal(broken.reason, "invalid_json");
  const fenced = extractJsonObject('```json\n{"rootCause":"insufficient_funds"}\n```');
  assert.equal(fenced.ok, true);
  if (fenced.ok) assert.equal(fenced.json.rootCause, "insufficient_funds");
});

test("Live AI payload has no playScores, heuristic answer, or eval secrets", () => {
  const ctx = gatherCaseContext(seed);
  const payload = buildLiveAiPayload(ctx, dx);
  const blob = JSON.stringify(payload);
  assert.equal("playScores" in payload, false);
  assert.equal("baselinePlay" in payload, false);
  assert.equal("recommendedPlay" in payload, false);
  assert.equal("recoveryProbability" in payload, false);
  assert.equal("comparedPlays" in payload, false);
  assert.equal(blob.includes("estimatedRecovery"), false);
  assert.equal(blob.includes("groundTruth"), false);
  assert.equal(blob.includes("latentOutcome"), false);
  assert.deepEqual(payload.allowedPlays, [
    "smart_retry",
    "payment_link",
    "hinglish_voice",
    "promise_to_pay",
    "human_escalate",
    "stop",
  ]);
  assert.equal(payload.gatewayHint.rootCause, dx.rootCause);
  assert.match(payload.instruction, /independent recommendation/i);
  assert.match(payload.instruction, /not copied from another score/i);
});

test("parsed Live AI probability stays the model value even when ranking scores differ", () => {
  const ranked = rankPlays(gatherCaseContext(seed), dx.rootCause, seed);
  const rec = parseLlmRecommendation(
    {
      rootCause: dx.rootCause,
      recoveryProbability: 0.41,
      recommendedPlay: "payment_link",
      confidence: 0.77,
      reasoning: ["Customer history is observable only"],
    },
    seed,
    dx,
    ranked,
    "gemini",
  );
  assert.ok(rec);
  assert.equal(rec.recoveryProbability, 0.41);
  assert.equal(rec.aiPredictedRecoveryProbability, 0.41);
  const heuristicScore = ranked.find((r) => r.play === rec.recommendedPlay)?.score;
  assert.ok(heuristicScore !== undefined);
  assert.notEqual(rec.recoveryProbability, heuristicScore);
  assert.equal(rec.recommendedPlay, "payment_link");
  assert.ok(rec.comparedPlays.length >= 1);
});

