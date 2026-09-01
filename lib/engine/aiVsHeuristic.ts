import { PLAY_LABEL } from "../format";
import type {
  AgentRecommendation,
  LiveAiStatus,
  PlayId,
  PolicyAction,
  RunCase,
} from "../types";
import { recommendRecoveryHeuristic } from "../agent/recommend";
import { liveAiUserMessage } from "../agent/liveAi";
import { explainPolicyDecision, type PolicyHeadline } from "./policyExplain";

export type AiVsHeuristicSide = {
  play: PlayId;
  playLabel: string;
  /** 0–1 prediction/estimate. Not recovered revenue. */
  probability: number;
  /** Rounded display percent from the stored 0–1 value. */
  probabilityPct: number;
  confidence: number;
  provider: AgentRecommendation["provider"];
  baselinePlay: PlayId;
};

export type AiVsHeuristicView = {
  liveAiStatus: LiveAiStatus;
  liveAi: AiVsHeuristicSide | null;
  heuristic: AiVsHeuristicSide;
  agreement: "same" | "differ" | "unavailable";
  agreementLabel: string;
  policyHeadline: PolicyHeadline;
  policyAction?: PolicyAction;
  /** Policy-resolved play. Not the AI recommendation. */
  finalPlay?: PlayId;
  finalActionLabel: string;
  outboundExecuted: boolean;
  aiDidNotWin: boolean;
  verifiedRecoveredInr: number;
};

function pct(probability: number): number {
  return Math.round(probability * 100);
}

function sideFrom(rec: AgentRecommendation): AiVsHeuristicSide {
  const probability = rec.aiPredictedRecoveryProbability ?? rec.recoveryProbability;
  return {
    play: rec.recommendedPlay,
    playLabel: PLAY_LABEL[rec.recommendedPlay],
    probability,
    probabilityPct: pct(probability),
    confidence: rec.confidence,
    provider: rec.provider,
    baselinePlay: rec.baselinePlay,
  };
}

function resolveLiveAiStatus(cse: RunCase): LiveAiStatus {
  if (cse.liveAiStatus) return cse.liveAiStatus;
  if (cse.agent?.provider === "openai" || cse.agent?.provider === "gemini") return "used";
  return "not_run";
}

/** Heuristic snapshot from the decision, or the same deterministic engine if none was stored. */
export function resolveHeuristicRecommendation(cse: RunCase): AgentRecommendation {
  if (cse.heuristic) return cse.heuristic;
  if (cse.agent?.provider === "heuristic") return cse.agent;
  return recommendRecoveryHeuristic(cse).agent;
}

function outboundExecuted(cse: RunCase): boolean {
  return (
    cse.executionStatus === "executed" &&
    Boolean(cse.play) &&
    cse.play!.id !== "stop" &&
    cse.play!.id !== "human_escalate"
  );
}

/**
 * AI vs heuristic comparison from stored recommendations.
 * Does not invent probabilities. Policy remains the authority.
 */
export function buildAiVsHeuristic(cse: RunCase): AiVsHeuristicView {
  const liveAiStatus = resolveLiveAiStatus(cse);
  const heuristic = sideFrom(resolveHeuristicRecommendation(cse));
  const liveAi =
    liveAiStatus === "used" && cse.agent && (cse.agent.provider === "openai" || cse.agent.provider === "gemini")
      ? sideFrom(cse.agent)
      : null;

  const explanation = explainPolicyDecision(cse);
  const executed = outboundExecuted(cse);
  const finalPlay = cse.play?.id;
  const finalActionLabel =
    !cse.policy && !cse.executionStatus
      ? "Not yet authorized"
      : executed && finalPlay
        ? PLAY_LABEL[finalPlay]
        : "No outbound action";

  let agreement: AiVsHeuristicView["agreement"] = "unavailable";
  let agreementLabel = "";
  if (
    liveAiStatus === "fallback" ||
    liveAiStatus === "unavailable" ||
    liveAiStatus === "timeout" ||
    liveAiStatus === "invalid_response" ||
    liveAiStatus === "rejected"
  ) {
    agreementLabel = liveAiUserMessage(liveAiStatus, cse.liveAiFailure);
  } else if (liveAi && liveAi.play === heuristic.play) {
    agreement = "same";
    agreementLabel = `Both recommend ${liveAi.playLabel}`;
  } else if (liveAi && liveAi.play !== heuristic.play) {
    agreement = "differ";
    agreementLabel = "AI differs from heuristic";
  }

  const blockedHeadline =
    explanation.headline === "BLOCKED" ||
    explanation.headline === "HELD" ||
    explanation.headline === "ESCALATED" ||
    explanation.headline === "QUEUED";

  return {
    liveAiStatus,
    liveAi,
    heuristic,
    agreement,
    agreementLabel,
    policyHeadline: explanation.headline,
    policyAction: explanation.policyAction,
    finalPlay,
    finalActionLabel,
    outboundExecuted: executed,
    aiDidNotWin: Boolean(
      liveAi && (blockedHeadline || (finalPlay && finalPlay !== liveAi.play) || !executed),
    ),
    verifiedRecoveredInr: cse.outcome?.recoveredInr ?? 0,
  };
}
