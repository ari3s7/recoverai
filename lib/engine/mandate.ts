import type { PlayId, PolicyConfig, SeedCase } from "../types";

export function isMandateCase(seed: SeedCase): boolean {
  return (
    seed.leakType === "mandate_failure" ||
    seed.signals.declineCode === "MANDATE_REVOKED" ||
    seed.signals.subReason === "mandate_revoked"
  );
}

export function mandateRetryCount(seed: SeedCase): number {
  return seed.signals.mandateRetryCount ?? seed.signals.retryCount ?? 0;
}

export function daysSinceOccurred(seed: SeedCase, at: Date): number {
  const start = new Date(seed.occurredAt).getTime();
  if (!Number.isFinite(start)) return 0;
  return Math.max(0, (at.getTime() - start) / 86_400_000);
}

export function recoveryWindowExpired(seed: SeedCase, policy: PolicyConfig, at: Date): boolean {
  if (seed.leakType === "overdue_invoice") return false;
  const windowDays = seed.signals.recoveryWindowDays ?? policy.recoveryWindowDays;
  return daysSinceOccurred(seed, at) > windowDays;
}

export function mandateCooldownActive(seed: SeedCase, policy: PolicyConfig, at: Date): boolean {
  const last = seed.signals.lastRetryAt ?? seed.signals.lastContactAt;
  if (!last) return false;
  const elapsedH = (at.getTime() - new Date(last).getTime()) / 3_600_000;
  return elapsedH >= 0 && elapsedH < policy.mandateRetryCooldownHours;
}

/**
 * Next bounded step for an e-mandate failure.
 * Policy still has to allow the play — this is only the sequencer recommendation.
 */
export function nextMandateStep(seed: SeedCase, policy: PolicyConfig, at: Date): PlayId {
  if (recoveryWindowExpired(seed, policy, at)) return "stop";
  if (seed.signals.declineCode === "MANDATE_REVOKED" || seed.signals.subReason === "mandate_revoked") {
    return "payment_link";
  }
  const retries = mandateRetryCount(seed);
  if (retries >= policy.maxMandateRetries) return "payment_link";
  if (mandateCooldownActive(seed, policy, at)) return "payment_link";
  return "smart_retry";
}

export type MandateSequence = {
  attempt: number;
  maxAttempts: number;
  cooldownActive: boolean;
  windowExpired: boolean;
  nextEligiblePlay: PlayId;
  reason: string;
};

/** Stateful snapshot for the mandate sequencer UI — policy still has to allow the next play. */
export function describeMandateSequence(seed: SeedCase, policy: PolicyConfig, at: Date): MandateSequence {
  const attempt = mandateRetryCount(seed);
  const cooldownActive = mandateCooldownActive(seed, policy, at);
  const windowExpired = recoveryWindowExpired(seed, policy, at);
  const nextEligiblePlay = nextMandateStep(seed, policy, at);
  let reason = `Retry ${attempt}/${policy.maxMandateRetries}.`;
  if (windowExpired) reason = "Recovery window expired. Stop.";
  else if (seed.signals.declineCode === "MANDATE_REVOKED" || seed.signals.subReason === "mandate_revoked") {
    reason = "Mandate revoked. Do not retry the dead token — send a fresh payment link.";
  } else if (attempt >= policy.maxMandateRetries) {
    reason = "Retry cap reached. Switch to payment-link re-authorization.";
  } else if (cooldownActive) {
    reason = `Cooldown ${policy.mandateRetryCooldownHours}h still active. Defer debit or send a link.`;
  } else {
    reason = `Eligible for mandate retry ${attempt + 1}/${policy.maxMandateRetries}.`;
  }
  return {
    attempt,
    maxAttempts: policy.maxMandateRetries,
    cooldownActive,
    windowExpired,
    nextEligiblePlay,
    reason,
  };
}
