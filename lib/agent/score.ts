import { recoveryProbability } from "../engine/execute";
import type { CaseContext, PlayId, RootCause } from "../types";

const PLAY_CATALOG: PlayId[] = [
  "smart_retry",
  "payment_link",
  "hinglish_voice",
  "promise_to_pay",
  "human_escalate",
  "stop",
];

export function calculateRecoveryScore(
  ctx: CaseContext,
  cause: RootCause,
  playId: PlayId,
): number {
  if (playId === "stop" || playId === "human_escalate") return 0;
  const base = recoveryProbability(cause, playId);
  const hist = ctx.customerHistory.paymentSuccessRate;
  const historyBoost = 0.75 + hist * 0.35;
  const contactPenalty = Math.max(0.55, 1 - ctx.customerHistory.contactsLast7Days * 0.12);
  const retryPenalty =
    playId === "smart_retry" && ctx.customerHistory.retryCount >= 2 ? 0.65 : 1;
  return Math.min(0.99, base * historyBoost * contactPenalty * retryPenalty);
}

export function rankPlays(ctx: CaseContext, cause: RootCause): Array<{ play: PlayId; score: number }> {
  return PLAY_CATALOG.map((play) => ({
    play,
    score: calculateRecoveryScore(ctx, cause, play),
  })).sort((a, b) => b.score - a.score);
}
