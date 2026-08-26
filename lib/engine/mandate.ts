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
