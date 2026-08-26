import { sandboxUnit } from "../engine/hash";
import type { Flag, LeakType, SeedCase } from "../types";

const CITIES = [
  "Mumbai",
  "Delhi",
  "Bengaluru",
  "Hyderabad",
  "Pune",
  "Chennai",
  "Ahmedabad",
  "Kolkata",
  "Jaipur",
  "Lucknow",
];

const FIRST = [
  "Aarav",
  "Diya",
  "Kabir",
  "Ananya",
  "Rohan",
  "Isha",
  "Vikram",
  "Sneha",
  "Arjun",
  "Meera",
  "Neel",
  "Tara",
  "Imran",
  "Pooja",
  "Yash",
];

type Persona = "loyal" | "typical" | "distressed" | "blocked";

function pick<T>(arr: T[], unit: number): T {
  return arr[Math.floor(unit * arr.length) % arr.length]!;
}

function personaOf(u: number): Persona {
  if (u < 0.34) return "loyal";
  if (u < 0.74) return "typical";
  if (u < 0.93) return "distressed";
  return "blocked";
}

function leakFor(persona: Persona, u: number): LeakType {
  if (persona === "blocked") {
    return pick(
      ["payment_failure", "failed_subscription", "overdue_invoice", "mandate_failure"] as LeakType[],
      u,
    );
  }
  const mix: LeakType[] =
    u < 0.32
      ? ["payment_failure"]
      : u < 0.5
        ? ["abandoned_checkout"]
        : u < 0.66
          ? ["failed_subscription"]
          : u < 0.82
            ? ["overdue_invoice"]
            : ["mandate_failure"];
  return mix[0]!;
}

export function generateSyntheticCases(count: number): SeedCase[] {
  const out: SeedCase[] = [];
  for (let i = 0; i < count; i++) {
    const id = `SYN-${10000 + i}`;
    const u1 = sandboxUnit(id, "a");
    const u2 = sandboxUnit(id, "b");
    const u3 = sandboxUnit(id, "c");
    const persona = personaOf(u2);
    const leak = leakFor(persona, u1);

    const flags: Flag[] = [];
    if (persona === "blocked") {
      if (u3 < 0.28) flags.push("dnc");
      else if (u3 < 0.5) flags.push("complaint");
      else if (u3 < 0.7) flags.push("legal");
      else if (u3 < 0.86) flags.push("fraud");
      else flags.push("chargeback");
    }

    const lifetime =
      persona === "loyal" ? Math.round(10 + u3 * 18) : persona === "typical" ? Math.round(5 + u3 * 12) : Math.round(3 + u3 * 8);
    const paymentSuccessRate =
      persona === "loyal"
        ? 0.86 + u1 * 0.11
        : persona === "typical"
          ? 0.58 + u1 * 0.18
          : persona === "distressed"
            ? 0.28 + u1 * 0.2
            : 0.18 + u1 * 0.15;
    const successfulPayments = Math.round(lifetime * paymentSuccessRate);
    const failedPayments = Math.max(0, lifetime - successfulPayments);
    const retryCount =
      persona === "loyal" ? 0 : persona === "typical" ? (u3 > 0.7 ? 1 : 0) : persona === "distressed" ? 1 + Math.floor(u3 * 3) : Math.floor(u3 * 2);
    const contactsLast7Days =
      persona === "distressed" ? 1 + Math.floor(u1 * 3) : persona === "blocked" ? Math.floor(u1 * 3) : u1 > 0.85 ? 1 : 0;

    const amountInr =
      leak === "overdue_invoice"
        ? u3 > 0.9
          ? Math.round(32000 + u1 * 60000)
          : Math.round(6500 + u1 * 14000)
        : u3 > 0.96
          ? Math.round(28000 + u2 * 40000)
          : Math.round(499 + u1 * 6500);

    if (leak !== "overdue_invoice" && amountInr >= 25000) flags.push("high_aov");
    if (leak === "overdue_invoice" && amountInr >= 25000) flags.push("high_aov");

    const promiseFulfillmentRate =
      persona === "loyal" ? 0.78 : persona === "typical" ? 0.52 : persona === "distressed" ? 0.28 : 0.12;
    const groundTruthPropensity = Math.min(
      0.94,
      Math.max(0.08, paymentSuccessRate * 0.88 - retryCount * 0.05 - contactsLast7Days * 0.04),
    );

    const name = `${pick(FIRST, u3)} ${pick(FIRST, u1)}`;
    const occurredAt = new Date(Date.now() - Math.round(u3 * 12) * 86_400_000).toISOString();

    const base: SeedCase = {
      id,
      customer: {
        name,
        city: pick(CITIES, u2),
        language: u2 > 0.35 ? "hinglish" : u2 > 0.2 ? "hindi" : "english",
        phoneMasked: "+91 98•• ••000",
        channelPref: leak === "overdue_invoice" ? "email" : "whatsapp",
        company: leak === "overdue_invoice" ? `${name} Traders` : undefined,
      },
      leakType: leak,
      amountInr,
      occurredAt,
      merchantSegment: leak === "overdue_invoice" ? "b2b" : "d2c",
      groundTruthPropensity,
      latentOutcomeSeed: sandboxUnit(id, "paired-latent"),
      signals: {
        retryCount,
        contactsLast7Days,
        paymentSuccessRate,
        lifetimePayments: lifetime,
        successfulPayments,
        failedPayments,
        avgPaymentInr: amountInr,
        avgPaymentDelayDays: persona === "loyal" ? Math.round(u1 * 3) : persona === "typical" ? Math.round(2 + u1 * 6) : Math.round(5 + u3 * 12),
        priorRecoveries: persona === "loyal" ? Math.floor(u1 * 2) : 0,
        subscriptionAgeMonths:
          leak === "failed_subscription" || leak === "mandate_failure" ? Math.round(2 + u2 * 24) : 0,
        previousAbandonments: leak === "abandoned_checkout" ? (persona === "loyal" ? 0 : 1 + Math.floor(u3 * 2)) : 0,
        previousPromises: leak === "overdue_invoice" ? Math.floor(u2 * 3) : 0,
        promiseFulfillmentRate,
        mandateRetryCount: leak === "mandate_failure" ? retryCount : 0,
        recoveryWindowDays: 14,
        flags,
      },
    };

    if (leak === "payment_failure") {
      const codes =
        persona === "loyal"
          ? ["INSUFFICIENT_FUNDS", "INSUFFICIENT_FUNDS", "INSUFFICIENT_FUNDS", "DO_NOT_HONOR"]
          : ["EXPIRED_CARD", "EXPIRED_CARD", "MANDATE_REVOKED", "INSUFFICIENT_FUNDS", "DO_NOT_HONOR"];
      base.signals.declineCode = pick(codes, u3);
    }
    if (leak === "abandoned_checkout") {
      base.signals.dropReason = pick(["price_shock", "checkout_friction", "payment_page_drop"], u2);
      base.signals.cartItems = ["Demo cart item"];
    }
    if (leak === "failed_subscription") {
      base.signals.subReason = pick(
        ["retry_exhausted", "expired_card", "forgotten_renewal"],
        u1,
      );
      if (base.signals.subReason === "expired_card") base.signals.declineCode = "EXPIRED_CARD";
    }
    if (leak === "overdue_invoice") {
      base.signals.invoiceNo = `INV-${9000 + i}`;
      base.signals.daysPastDue =
        u2 > 0.88 ? Math.floor(62 + u3 * 20) : Math.floor(10 + u3 * 38);
      base.signals.invoiceReason = pick(["cashflow_delay", "dispute_unaware", "forgotten_renewal"], u2);
      if (u1 > 0.88 && persona !== "blocked") {
        base.signals.promiseToPayDate = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);
      }
    }
    if (leak === "mandate_failure") {
      base.signals.declineCode = u3 > 0.38 ? "MANDATE_REVOKED" : "INSUFFICIENT_FUNDS";
      base.signals.subReason = base.signals.declineCode === "MANDATE_REVOKED" ? "mandate_revoked" : undefined;
    }

    out.push(base);
  }
  return out;
}
