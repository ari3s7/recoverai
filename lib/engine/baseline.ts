import { diagnose } from "./diagnose";
import { isMandateCase, mandateRetryCount } from "./mandate";
import type { Diagnosis, PlayId, SeedCase } from "../types";

/**
 * Naive merchant playbook: one generic reminder / one blind retry.
 * Same dataset and policy gate as RecoverAI; no scoring, no voice, no PTP.
 */
export function baselineRecommendPlay(seed: SeedCase, dx?: Diagnosis): PlayId {
  const cause = dx?.rootCause ?? diagnose(seed).rootCause;
  const flags = seed.signals.flags;
  if (flags.some((f) => ["dnc", "complaint", "legal", "fraud", "chargeback"].includes(f))) {
    return "stop";
  }
  if (seed.signals.promiseToPayDate) return "stop";

  if (isMandateCase(seed)) {
    return mandateRetryCount(seed) < 2 ? "smart_retry" : "payment_link";
  }

  if (seed.leakType === "payment_failure" || seed.leakType === "failed_subscription") {
    if (cause === "expired_card" || cause === "mandate_revoked") {
      return seed.signals.retryCount < 1 ? "smart_retry" : "payment_link";
    }
    return seed.signals.retryCount < 1 ? "smart_retry" : "payment_link";
  }
  if (seed.leakType === "abandoned_checkout") return "payment_link";
  if (seed.leakType === "overdue_invoice") return "payment_link";
  return "payment_link";
}

