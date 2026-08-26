import { CAUSE_LABEL, inr, LEAK_LABEL } from "../format";
import type { Diagnosis, RootCause, SeedCase } from "../types";

function causeFor(seed: SeedCase): RootCause {
  if (seed.leakType === "payment_failure") {
    const code = seed.signals.declineCode ?? "";
    if (code === "EXPIRED_CARD") return "expired_card";
    if (code === "INSUFFICIENT_FUNDS") return "insufficient_funds";
    if (code === "MANDATE_REVOKED") return "mandate_revoked";
    return "bank_decline";
  }
  if (seed.leakType === "abandoned_checkout") {
    return seed.signals.dropReason ?? "payment_page_drop";
  }
  if (seed.leakType === "failed_subscription") {
    return seed.signals.subReason ?? "retry_exhausted";
  }
  return seed.signals.invoiceReason ?? "cashflow_delay";
}

function evidence(seed: SeedCase, cause: RootCause): string[] {
  const items: string[] = [];
  items.push(`${LEAK_LABEL[seed.leakType]} · ${inr(seed.amountInr)}`);
  items.push(`${seed.customer.city} · ${seed.customer.language} · ${seed.customer.channelPref}`);
  if (seed.signals.declineCode) items.push(`Gateway code ${seed.signals.declineCode}`);
  if (seed.signals.retryCount) items.push(`${seed.signals.retryCount} automatic retries already fired`);
  if (seed.signals.contactsLast7Days) {
    items.push(`${seed.signals.contactsLast7Days} outbound contacts in the last 7 days`);
  }
  if (seed.signals.cartItems?.length) items.push(`Cart: ${seed.signals.cartItems.join(", ")}`);
  if (seed.signals.invoiceNo) {
    items.push(`${seed.signals.invoiceNo} · ${seed.signals.daysPastDue ?? 0} days past due`);
  }
  if (seed.signals.promiseToPayDate) items.push(`Active promise-to-pay ${seed.signals.promiseToPayDate}`);
  if (seed.signals.flags.length) items.push(`Flags: ${seed.signals.flags.join(", ")}`);
  if (cause === "price_shock") items.push("AOV vs session drop pattern matches price hesitation");
  return items;
}

function narrative(seed: SeedCase, cause: RootCause): string {
  const who = seed.customer.company
    ? `${seed.customer.company} (${seed.customer.name})`
    : seed.customer.name;
  const amt = inr(seed.amountInr);
  switch (cause) {
    case "insufficient_funds":
      return `${who}: ${amt} failed on insufficient funds. A delayed retry after payroll/UPI reload is higher-yield than another immediate debit.`;
    case "expired_card":
      return `${who}: instrument expired. Recovery requires a new method, not another charge on the dead card.`;
    case "bank_decline":
      return `${who}: issuer declined (${seed.signals.declineCode ?? "DO_NOT_HONOR"}). Blind retries will burn the mandate; switch channel and wait.`;
    case "mandate_revoked":
      return `${who}: e-mandate cancelled. Need a fresh authorization before any debit.`;
    case "price_shock":
      return `${who} dropped ${seed.signals.cartItems?.[0] ?? "the cart"} at ${amt}. Pattern fits price hesitation — voice can handle the objection; email will not.`;
    case "checkout_friction":
      return `${who} stalled in checkout on a ${amt} order. Likely address/UPI friction. A prefilled payment link removes the form.`;
    case "payment_page_drop":
      return `${who} reached pay and left. Intent is high; a same-day Hinglish call plus a live link recovers this cohort.`;
    case "retry_exhausted":
      return `${who}: subscription dunning already exhausted ${seed.signals.retryCount} retries on ${amt}. Next debit without a new instrument will fail.`;
    case "cashflow_delay":
      return `${who}: ${seed.signals.invoiceNo ?? "invoice"} is ${seed.signals.daysPastDue ?? 0} DPD. This is cashflow, not unwillingness — capture a dated promise, do not stack reminders.`;
    case "dispute_unaware":
      return `${who} has not acknowledged ${seed.signals.invoiceNo ?? "the invoice"}. First job is proof-of-debt, not a collections script.`;
    case "forgotten_renewal":
      return `${who}'s ${amt} renewal lapsed without a hard decline. A short reminder in their language usually closes it.`;
  }
}

function confidence(seed: SeedCase, cause: RootCause): number {
  let n = 72;
  if (seed.signals.declineCode) n += 12;
  if (seed.signals.dropReason || seed.signals.subReason || seed.signals.invoiceReason) n += 8;
  if (seed.signals.flags.includes("fraud") || seed.signals.flags.includes("chargeback")) n += 4;
  if (cause === "bank_decline" && !seed.signals.declineCode) n -= 10;
  return Math.min(96, n);
}

export function diagnose(seed: SeedCase): Diagnosis {
  const rootCause = causeFor(seed);
  return {
    rootCause,
    label: CAUSE_LABEL[rootCause],
    confidence: confidence(seed, rootCause),
    evidence: evidence(seed, rootCause),
    narrative: narrative(seed, rootCause),
  };
}
