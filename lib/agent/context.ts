import type { CaseContext, RunCase, SeedCase } from "../types";

function observedHistory(seed: SeedCase) {
  const lifetime = seed.signals.lifetimePayments ?? 6;
  const rate = seed.signals.paymentSuccessRate ?? 0.62;
  const successful = seed.signals.successfulPayments ?? Math.round(lifetime * rate);
  const failed = seed.signals.failedPayments ?? Math.max(0, lifetime - successful);
  return {
    paymentSuccessRate: rate,
    lifetimePayments: lifetime,
    successfulPayments: successful,
    failedPayments: failed,
    avgPaymentInr: seed.signals.avgPaymentInr ?? seed.amountInr,
    avgPaymentDelayDays: seed.signals.avgPaymentDelayDays ?? 0,
    priorRecoveries: seed.signals.priorRecoveries ?? 0,
    subscriptionAgeMonths: seed.signals.subscriptionAgeMonths ?? 0,
    previousAbandonments: seed.signals.previousAbandonments ?? 0,
    previousPromises: seed.signals.previousPromises ?? 0,
    promiseFulfillmentRate: seed.signals.promiseFulfillmentRate ?? 0,
    contactsLast7Days: seed.signals.contactsLast7Days,
    retryCount: seed.signals.retryCount,
    mandateRetryCount: seed.signals.mandateRetryCount ?? 0,
  };
}

/** Structured context the recovery agent reads before recommending. Never includes ground-truth propensity. */
export function gatherCaseContext(seed: SeedCase): CaseContext {
  const history = observedHistory(seed);
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
      `prior_abandons=${history.previousAbandonments}`,
    ]
      .filter(Boolean)
      .join(", ");
  }
  if (seed.leakType === "failed_subscription") {
    ctx.subscriptionContext = [
      seed.signals.subReason ?? "unknown_sub",
      seed.signals.declineCode ? `decline=${seed.signals.declineCode}` : null,
      `age_months=${history.subscriptionAgeMonths}`,
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
  if (seed.leakType === "mandate_failure" || seed.signals.declineCode === "MANDATE_REVOKED") {
    ctx.mandateContext = [
      seed.signals.declineCode ? `decline=${seed.signals.declineCode}` : "mandate_debit_failed",
      `mandate_retries=${history.mandateRetryCount}`,
      seed.signals.lastRetryAt ? `last_retry=${seed.signals.lastRetryAt}` : null,
    ]
      .filter(Boolean)
      .join(", ");
  }
  if (seed.signals.promiseToPayDate) {
    ctx.promiseContext = `active_ptp=${seed.signals.promiseToPayDate}; fulfillment_rate=${history.promiseFulfillmentRate}`;
  }

  return ctx;
}

export function getCaseContext(c: RunCase | SeedCase): CaseContext {
  return gatherCaseContext(c);
}

export function getCustomerHistory(c: SeedCase) {
  return observedHistory(c);
}

export function getPaymentContext(c: SeedCase) {
  return gatherCaseContext(c).paymentContext;
}

export function getCheckoutContext(c: SeedCase) {
  return gatherCaseContext(c).checkoutContext;
}

export function getSubscriptionContext(c: SeedCase) {
  return gatherCaseContext(c).subscriptionContext;
}

export function getInvoiceContext(c: SeedCase) {
  return gatherCaseContext(c).invoiceContext;
}

export function getPromiseContext(c: SeedCase) {
  return gatherCaseContext(c).promiseContext;
}

export function getMandateContext(c: SeedCase) {
  return gatherCaseContext(c).mandateContext;
}
