import assert from "node:assert/strict";
import { test } from "node:test";
import { gatherCaseContext } from "../lib/agent/context";
import {
  parseLlmRecommendation,
  recommendRecovery,
  recommendRecoveryHeuristic,
} from "../lib/agent/recommend";
import { rankPlays } from "../lib/agent/score";
import { resolvePlayAfterPolicy } from "../lib/agent/validate";
import { diagnose } from "../lib/engine/diagnose";
import { buildAiVsHeuristic } from "../lib/engine/aiVsHeuristic";
import { evaluatePolicy } from "../lib/engine/policy";
import { processCase } from "../lib/engine/process";
import { PLAY_LABEL } from "../lib/format";
import { DEFAULT_POLICY, policyNow } from "../lib/policy/defaults";
import { SEED_CASES } from "../lib/seed/cases";
import type { AgentRecommendation, PlayId, RunCase, SeedCase } from "../lib/types";
import { asRunCase, byName, withPolicy } from "./helpers";

const now = policyNow(DEFAULT_POLICY);

function seed(name: string) {
  return asRunCase(byName(SEED_CASES, name));
}

function parsedLiveAi(
  cse: SeedCase,
  recommendedPlay: PlayId,
  recoveryProbability: number,
  confidence: number,
): AgentRecommendation {
  const dx = diagnose(cse);
  const ranked = rankPlays(gatherCaseContext(cse), dx.rootCause, cse);
  const rec = parseLlmRecommendation(
    {
      rootCause: dx.rootCause,
      recoveryProbability,
      recommendedPlay,
      confidence,
      reasoning: ["11 of 12 previous payments succeeded", "Current failure is isolated"],
    },
    cse,
    dx,
    ranked,
    "openai",
  );
  assert.ok(rec);
  return rec;
}

function overlayLiveAi(cse: RunCase, ai: AgentRecommendation, heuristic: AgentRecommendation): RunCase {
  return { ...cse, agent: { ...ai, rootCause: cse.diagnosis?.rootCause ?? ai.rootCause }, heuristic, liveAiStatus: "used" };
}

test("AI and heuristic recommend different plays", () => {
  const cse = seed("Ananya Mehta");
  const heuristic = recommendRecoveryHeuristic(cse).agent;
  const other: PlayId = heuristic.recommendedPlay === "payment_link" ? "smart_retry" : "payment_link";
  const ai = parsedLiveAi(cse, other, 0.41, 0.73);
  const view = buildAiVsHeuristic(overlayLiveAi(cse, ai, heuristic));
  assert.equal(view.liveAiStatus, "used");
  assert.equal(view.liveAi?.play, other);
  assert.equal(view.heuristic.play, heuristic.recommendedPlay);
  assert.notEqual(view.liveAi?.play, view.heuristic.play);
  assert.equal(view.agreement, "differ");
  assert.equal(view.agreementLabel, "AI differs from heuristic");
  assert.equal(view.liveAi?.probability, ai.recoveryProbability);
  assert.equal(view.heuristic.probability, heuristic.recoveryProbability);
});

test("AI and heuristic recommend the same play", () => {
  const cse = seed("Ananya Mehta");
  const heuristic = recommendRecoveryHeuristic(cse).agent;
  const ai = parsedLiveAi(cse, heuristic.recommendedPlay, 0.41, 0.73);
  const view = buildAiVsHeuristic(overlayLiveAi(cse, ai, heuristic));
  assert.equal(view.agreement, "same");
  assert.equal(view.agreementLabel, `Both recommend ${PLAY_LABEL[heuristic.recommendedPlay]}`);
  assert.equal(view.liveAi?.play, view.heuristic.play);
});

test("Live AI has not been run", async () => {
  const fresh = seed("Ananya Mehta");
  const freshView = buildAiVsHeuristic(fresh);
  assert.equal(freshView.liveAiStatus, "not_run");
  assert.equal(freshView.liveAi, null);
  assert.equal(freshView.finalActionLabel, "Not yet authorized");
  const expected = recommendRecoveryHeuristic(fresh).agent;
  assert.equal(freshView.heuristic.play, expected.recommendedPlay);
  assert.equal(freshView.heuristic.probability, expected.recoveryProbability);

  const processed = await processCase(fresh, DEFAULT_POLICY, now);
  assert.equal(processed.liveAiStatus, "not_run");
  assert.equal(processed.heuristic?.provider, "heuristic");
  assert.equal(processed.agent?.provider, "heuristic");
  assert.equal(processed.heuristic?.recommendedPlay, processed.agent?.recommendedPlay);
  const view = buildAiVsHeuristic(processed);
  assert.equal(view.liveAiStatus, "not_run");
  assert.equal(view.liveAi, null);
  assert.equal(view.heuristic.play, processed.heuristic?.recommendedPlay);
});

test("AI recommendation is invalid and heuristic fallback is used", async () => {
  const cse = seed("Ananya Mehta");
  const dx = diagnose(cse);
  const ranked = rankPlays(gatherCaseContext(cse), dx.rootCause, cse);
  assert.equal(
    parseLlmRecommendation({ recommendedPlay: "wire_transfer" }, cse, dx, ranked, "openai"),
    null,
  );
  const rec = await recommendRecovery(cse, { forceHeuristic: true });
  assert.equal(rec.liveAi, null);
  assert.equal(rec.agent.provider, "heuristic");
  assert.equal(rec.heuristic.recommendedPlay, rec.agent.recommendedPlay);

  const processed = await processCase(cse, DEFAULT_POLICY, now);
  const view = buildAiVsHeuristic({
    ...processed,
    liveAiStatus: "fallback",
    agent: processed.heuristic ?? processed.agent,
    heuristic: processed.heuristic,
  });
  assert.equal(view.liveAiStatus, "fallback");
  assert.equal(view.liveAi, null);
  assert.match(view.agreementLabel, /heuristic used/i);
  assert.equal(view.heuristic.play, processed.agent?.recommendedPlay);
  assert.equal(view.heuristic.probability, processed.heuristic?.recoveryProbability);
});

test("Policy overrides the AI recommendation", async () => {
  const cse = seed("Farhan Ali");
  const heuristic = recommendRecoveryHeuristic(cse).agent;
  const ai = parsedLiveAi(cse, "payment_link", 0.41, 0.73);
  const processed = await processCase(cse, DEFAULT_POLICY, now);
  assert.equal(processed.policy?.action, "stop");
  assert.equal(processed.executionStatus, "blocked");
  assert.equal(processed.play?.id, "stop");

  const resolved = resolvePlayAfterPolicy(ai, processed.policy!, heuristic.recommendedPlay, cse, DEFAULT_POLICY, now);
  assert.equal(resolved, "stop");
  assert.notEqual(ai.recommendedPlay, resolved);

  const view = buildAiVsHeuristic(overlayLiveAi(processed, ai, heuristic));
  assert.equal(view.liveAi?.play, "payment_link");
  assert.equal(view.policyHeadline, "BLOCKED");
  assert.equal(view.finalPlay, "stop");
  assert.equal(view.finalActionLabel, "No outbound action");
  assert.equal(view.aiDidNotWin, true);
  assert.equal(view.outboundExecuted, false);
});

test("STOP blocks both recommendations from executing", async () => {
  const processed = await processCase(seed("Farhan Ali"), DEFAULT_POLICY, now);
  const heuristic = processed.heuristic ?? processed.agent!;
  const ai = parsedLiveAi(processed, "payment_link", 0.41, 0.73);
  const view = buildAiVsHeuristic(overlayLiveAi(processed, ai, heuristic));
  assert.equal(processed.executionStatus, "blocked");
  assert.equal(processed.execution?.settled, false);
  assert.equal(processed.paymentLinkUrl, undefined);
  assert.equal(view.outboundExecuted, false);
  assert.equal(view.finalActionLabel, "No outbound action");
  assert.equal(view.verifiedRecoveredInr, 0);
});

test("HOLD ESCALATE QUEUED also block outbound in the comparison", async () => {
  const held = await processCase(seed("Diya Nair"), DEFAULT_POLICY, now);
  const heuristicH = held.heuristic ?? held.agent!;
  const heldView = buildAiVsHeuristic(overlayLiveAi(held, parsedLiveAi(held, "payment_link", 0.41, 0.73), heuristicH));
  assert.equal(heldView.policyHeadline, "HELD");
  assert.equal(heldView.finalActionLabel, "No outbound action");
  assert.equal(held.executionStatus, "held");

  const escalated = await processCase(seed("Neel Logistics"), DEFAULT_POLICY, now);
  const heuristicE = escalated.heuristic ?? escalated.agent!;
  const escView = buildAiVsHeuristic(
    overlayLiveAi(escalated, parsedLiveAi(escalated, "payment_link", 0.41, 0.73), heuristicE),
  );
  assert.equal(escView.policyHeadline, "ESCALATED");
  assert.equal(escView.finalActionLabel, "No outbound action");
  assert.equal(escalated.executionStatus, "escalated");

  const queued = await processCase(seed("Ananya Mehta"), withPolicy({ autoExecute: false }), now);
  const heuristicQ = queued.heuristic ?? queued.agent!;
  const queuedView = buildAiVsHeuristic(
    overlayLiveAi(queued, parsedLiveAi(queued, "payment_link", 0.41, 0.73), heuristicQ),
  );
  assert.equal(queuedView.policyHeadline, "QUEUED");
  assert.equal(queuedView.finalActionLabel, "No outbound action");
  assert.equal(queued.executionStatus, "queued");
});

test("Probability and confidence displayed are the actual parsed values", () => {
  const cse = seed("Ananya Mehta");
  const heuristic = recommendRecoveryHeuristic(cse).agent;
  const ai = parsedLiveAi(cse, "payment_link", 0.41, 0.73);
  assert.equal(ai.recoveryProbability, 0.41);
  assert.equal(ai.aiPredictedRecoveryProbability, 0.41);
  assert.equal(ai.confidence, 73);
  const view = buildAiVsHeuristic(overlayLiveAi(cse, ai, heuristic));
  assert.equal(view.liveAi?.probability, 0.41);
  assert.equal(view.liveAi?.probabilityPct, Math.round(ai.recoveryProbability * 100));
  assert.equal(view.liveAi?.confidence, ai.confidence);
  assert.equal(view.heuristic.probability, heuristic.recoveryProbability);
  assert.equal(view.heuristic.probabilityPct, Math.round(heuristic.recoveryProbability * 100));
  assert.equal(view.heuristic.baselinePlay, heuristic.baselinePlay);
});

test("No fake or hardcoded comparison values", () => {
  const cse = seed("Ananya Mehta");
  const heuristic = recommendRecoveryHeuristic(cse).agent;
  const ai = parsedLiveAi(cse, "hinglish_voice", 0.23, 0.61);
  const view = buildAiVsHeuristic(overlayLiveAi(cse, ai, heuristic));
  assert.equal(view.liveAi?.probability, ai.aiPredictedRecoveryProbability);
  assert.equal(view.liveAi?.probabilityPct, Math.round(0.23 * 100));
  assert.equal(view.liveAi?.confidence, 61);
  assert.equal(view.heuristic.probability, heuristic.recoveryProbability);
  const blob = JSON.stringify(view);
  assert.equal(blob.includes("groundTruth"), false);
  assert.equal(blob.includes("latentOutcome"), false);
});

test("Verified recovery remains separate from predicted recovery", async () => {
  const cse = seed("Farhan Ali");
  const heuristic = recommendRecoveryHeuristic(cse).agent;
  const ai = parsedLiveAi(cse, "payment_link", 0.41, 0.73);
  const processed = await processCase(cse, DEFAULT_POLICY, now);
  const view = buildAiVsHeuristic(overlayLiveAi(processed, ai, heuristic));
  assert.equal(view.liveAi?.probabilityPct, 41);
  assert.equal(view.verifiedRecoveredInr, 0);
  assert.notEqual(view.verifiedRecoveredInr, view.liveAi?.probabilityPct);
  assert.equal(processed.outcome?.recoveredInr ?? 0, 0);
  assert.equal(evaluatePolicy(cse, DEFAULT_POLICY, now).action, "stop");
});
