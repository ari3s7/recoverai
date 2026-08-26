import { sandboxUnit } from "../engine/execute";
import type { CaseContext, RunCase, SeedCase } from "../types";

function deriveHistory(seed: SeedCase) {
  const roll = sandboxUnit(seed.id, "history");
  const paymentSuccessRate =
    seed.signals.paymentSuccessRate ??
    Math.min(0.98, Math.max(0.35, 0.55 + roll * 0.4 - (seed.signals.retryCount ?? 0) * 0.06));
  const lifetimePayments =
    seed.signals.lifetimePayments ?? Math.round(4 + roll * 20 + paymentSuccessRate * 12);
  const priorRecoveries = seed.signals.priorRecoveries ?? Math.floor(roll * 3);
  return {
    paymentSuccessRate,
    lifetimePayments,
    priorRecoveries,
    contactsLast7Days: seed.signals.contactsLast7Days,
    retryCount: seed.signals.retryCount,
  };
}

/** Structured context the recovery agent reads before recommending. */
export function gatherCaseContext(seed: SeedCase): CaseContext {
  const history = deriveHistory(seed);
  const ctx: CaseContext = {
    caseId: seed.id,
    leakType: seed.leakType,
    amountInr: seed.amountInr,
    segment: seed.merchantSegment,
    customer: seed.customer,
    signals: seed.signals,
    customerHistory: history,
  };

  if (seed.leakType === "payment_failure" || seed.signals.declineCode) {
    ctx.paymentContext = [
      seed.signals.declineCode ? `decline=${seed.signals.declineCode}` : null,
      `retries=${seed.signals.retryCount}`,
      `contacts7d=${seed.signals.contactsLast7Days}`,
    ]
      .filter(Boolean)
      .join(", ");
  }
  if (seed.leakType === "abandoned_checkout") {
    ctx.checkoutContext = [
      seed.signals.dropReason ?? "unknown_drop",
      seed.signals.cartItems?.length ? `cart=${seed.signals.cartItems.join("; ")}` : null,
    ]
      .filter(Boolean)
      .join(", ");
  }
  if (seed.leakType === "failed_subscription") {
    ctx.subscriptionContext = [
      seed.signals.subReason ?? "unknown_sub",
      seed.signals.declineCode ? `decline=${seed.signals.declineCode}` : null,
    ]
      .filter(Boolean)
      .join(", ");
  }
  if (seed.leakType === "overdue_invoice") {
    ctx.invoiceContext = [
      seed.signals.invoiceNo ?? "invoice",
      `dpd=${seed.signals.daysPastDue ?? 0}`,
      seed.signals.invoiceReason ?? "unknown",
    ].join(", ");
  }
  if (seed.signals.promiseToPayDate) {
    ctx.promiseContext = `active_ptp=${seed.signals.promiseToPayDate}`;
  }

  return ctx;
}

export function getCaseContext(c: RunCase | SeedCase): CaseContext {
  return gatherCaseContext(c);
}
