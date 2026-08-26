import type { PlayId, RootCause, SeedCase } from "../types";
import { sandboxUnit } from "./hash";

/**
 * Hidden play-fit used only by the simulator / sandbox settlement.
 * Intentionally different from the agent-facing FIT table in execute.ts so
 * predicted recoveryProbability ≠ actual outcome.
 */
const TRUTH_FIT: Record<RootCause, Partial<Record<PlayId, number>>> = {
  insufficient_funds: { smart_retry: 0.68, hinglish_voice: 0.34, payment_link: 0.24 },
  expired_card: { payment_link: 0.8, hinglish_voice: 0.5, smart_retry: 0.03 },
  bank_decline: { hinglish_voice: 0.46, payment_link: 0.24, smart_retry: 0.08 },
  mandate_revoked: { payment_link: 0.58, hinglish_voice: 0.3, smart_retry: 0.02 },
  price_shock: { hinglish_voice: 0.7, payment_link: 0.18, smart_retry: 0.05 },
  checkout_friction: { payment_link: 0.62, hinglish_voice: 0.32, smart_retry: 0.06 },
  payment_page_drop: { hinglish_voice: 0.6, payment_link: 0.32, smart_retry: 0.06 },
  retry_exhausted: { payment_link: 0.5, hinglish_voice: 0.36, smart_retry: 0.05 },
  cashflow_delay: { payment_link: 0.14, hinglish_voice: 0.16, smart_retry: 0.03 },
  dispute_unaware: { payment_link: 0.48, hinglish_voice: 0.16, smart_retry: 0.03 },
  forgotten_renewal: { hinglish_voice: 0.62, payment_link: 0.4, smart_retry: 0.1 },
};

function clamp01(n: number): number {
  return Math.min(0.97, Math.max(0.01, n));
}

export function groundTruthProbability(seed: SeedCase, cause: RootCause, playId: PlayId): number {
  if (playId === "stop" || playId === "human_escalate") return 0;
  if (playId === "promise_to_pay") {
    return clamp01((seed.signals.promiseFulfillmentRate ?? seed.groundTruthPropensity ?? 0.45) * 0.82);
  }
  const latent =
    seed.groundTruthPropensity ??
    seed.signals.paymentSuccessRate ??
    0.45;
  const fit = TRUTH_FIT[cause]?.[playId] ?? 0.14;
  const contactPenalty = Math.max(0.42, 1 - seed.signals.contactsLast7Days * 0.14);
  const retryPenalty =
    playId === "smart_retry" && seed.signals.retryCount >= 2 ? 0.55 : 1;
  return clamp01(latent * fit * contactPenalty * retryPenalty * 1.35);
}

export function pairedLatent(seed: SeedCase): number {
  if (typeof seed.latentOutcomeSeed === "number" && Number.isFinite(seed.latentOutcomeSeed)) {
    return Math.min(0.9999, Math.max(0, seed.latentOutcomeSeed));
  }
  return sandboxUnit(seed.id, "paired-latent");
}

export function settleAgainstGroundTruth(
  seed: SeedCase,
  cause: RootCause,
  playId: PlayId,
): boolean {
  const p = groundTruthProbability(seed, cause, playId);
  return pairedLatent(seed) < p;
}
