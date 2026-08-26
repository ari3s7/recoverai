import type { CaseStatus, LeakType, PlayId, RootCause } from "./types";

export function inr(n: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(n);
}

export function ist(iso: string): string {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

export function istClock(iso?: string): string {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(iso ? new Date(iso) : new Date());
}

export function istDate(iso: string): string {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(iso));
}

export const LEAK_LABEL: Record<LeakType, string> = {
  payment_failure: "Payment failure",
  abandoned_checkout: "Abandoned checkout",
  failed_subscription: "Failed subscription",
  overdue_invoice: "Overdue invoice",
};

export const CAUSE_LABEL: Record<RootCause, string> = {
  insufficient_funds: "Insufficient funds",
  expired_card: "Expired card",
  bank_decline: "Bank decline",
  mandate_revoked: "Mandate revoked",
  price_shock: "Price shock",
  checkout_friction: "Checkout friction",
  payment_page_drop: "Payment-page drop",
  retry_exhausted: "Retries exhausted",
  cashflow_delay: "Cashflow delay",
  dispute_unaware: "Unaware of invoice",
  forgotten_renewal: "Forgotten renewal",
};

export const PLAY_LABEL: Record<PlayId, string> = {
  smart_retry: "Smart retry",
  payment_link: "Payment link",
  hinglish_voice: "Hinglish voice",
  promise_to_pay: "Promise-to-pay",
  human_escalate: "Human escalate",
  stop: "Stop",
};

export const STATUS_LABEL: Record<CaseStatus, string> = {
  at_risk: "At risk",
  in_flight: "In flight",
  recovered: "Recovered",
  promised: "Promised",
  escalated: "Escalated",
  stopped: "Stopped",
  held: "Held",
};
