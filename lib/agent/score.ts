import { recoveryProbability } from "../engine/execute";
import { isMandateCase } from "../engine/mandate";
import type { CaseContext, PlayId, RootCause, SeedCase } from "../types";

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
  const historyBoost = 0.7 + hist * 0.4;
  const contactPenalty = Math.max(0.5, 1 - ctx.customerHistory.contactsLast7Days * 0.12);
  const retryPenalty =
    playId === "smart_retry" && ctx.customerHistory.retryCount >= 2 ? 0.55 : 1;
  const mandatePenalty =
    playId === "smart_retry" &&
    (cause === "mandate_revoked" || ctx.leakType === "mandate_failure") &&
    ctx.signals.declineCode === "MANDATE_REVOKED"
      ? 0.08
      : 1;
  const voicePenalty =
    playId === "hinglish_voice" && ctx.customer.language === "english" ? 0.45 : 1;
  const ptpBoost =
    playId === "promise_to_pay" && cause === "cashflow_delay"
      ? 0.9 + ctx.customerHistory.promiseFulfillmentRate * 0.4
      : 1;
  return Math.min(0.96, base * historyBoost * contactPenalty * retryPenalty * mandatePenalty * voicePenalty * ptpBoost);
}

export function rankPlays(
  ctx: CaseContext,
  cause: RootCause,
  seed?: SeedCase,
): Array<{ play: PlayId; score: number }> {
  return PLAY_CATALOG.map((play) => ({
    play,
    score: calculateRecoveryScore(ctx, cause, play),
  }))
    .map((row) => {
      if (row.play === "smart_retry" && seed && isMandateCase(seed) && seed.signals.declineCode === "MANDATE_REVOKED") {
        return { ...row, score: 0.04 };
      }
      return row;
    })
    .sort((a, b) => b.score - a.score);
}

export function analyzeRootCause(ctx: CaseContext, cause: RootCause): string[] {
  const h = ctx.customerHistory;
  const bits = [
    `${h.successfulPayments}/${h.lifetimePayments} historical payments succeeded`,
    h.retryCount ? `${h.retryCount} prior automatic retries` : "No prior retries this cycle",
    h.contactsLast7Days ? `${h.contactsLast7Days} contacts in 7 days` : "No recent outbound contacts",
  ];
  if (ctx.paymentContext) bits.push(ctx.paymentContext);
  if (ctx.mandateContext) bits.push(ctx.mandateContext);
  if (cause) bits.push(`Working diagnosis ${cause}`);
  return bits;
}
