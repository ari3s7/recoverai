import { sandboxUnit } from "../engine/execute";
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

const LEAKS: LeakType[] = [
  "payment_failure",
  "abandoned_checkout",
  "failed_subscription",
  "overdue_invoice",
];

function pick<T>(arr: T[], unit: number): T {
  return arr[Math.floor(unit * arr.length) % arr.length]!;
}

export function generateSyntheticCases(count: number): SeedCase[] {
  const out: SeedCase[] = [];
  for (let i = 0; i < count; i++) {
    const id = `SYN-${10000 + i}`;
    const u1 = sandboxUnit(id, "a");
    const u2 = sandboxUnit(id, "b");
    const u3 = sandboxUnit(id, "c");
    const leak = pick(LEAKS, u1);
    const paymentSuccessRate = Math.min(0.97, Math.max(0.25, 0.45 + u2 * 0.5));
    const lifetimePayments = Math.round(3 + u3 * 24);
    const amountInr = Math.round(499 + u1 * 180000);
    const flags: Flag[] = [];
    if (u2 > 0.96) flags.push("dnc");
    if (u2 > 0.94 && u2 <= 0.96) flags.push("complaint");
    if (u3 > 0.97) flags.push("fraud");
    if (amountInr >= 25000) flags.push("high_aov");

    const name = `${pick(FIRST, u3)} ${pick(FIRST, u1)}`;
    const city = pick(CITIES, u2);
    const retryCount = u3 > 0.7 ? Math.floor(u3 * 4) : 0;
    const contactsLast7Days = u1 > 0.85 ? Math.floor(u1 * 4) : 0;

    const base: SeedCase = {
      id,
      customer: {
        name,
        city,
        language: u2 > 0.75 ? "hinglish" : u2 > 0.5 ? "hindi" : "english",
        phoneMasked: "+91 98•• ••000",
        channelPref: "whatsapp",
      },
      leakType: leak,
      amountInr,
      occurredAt: new Date(Date.now() - i * 3600_000).toISOString(),
      merchantSegment: leak === "overdue_invoice" ? "b2b" : "d2c",
      signals: {
        retryCount,
        contactsLast7Days,
        paymentSuccessRate,
        lifetimePayments,
        priorRecoveries: Math.floor(u1 * 2),
        flags,
      },
    };

    if (leak === "payment_failure") {
      const codes = ["INSUFFICIENT_FUNDS", "EXPIRED_CARD", "DO_NOT_HONOR", "MANDATE_REVOKED"];
      base.signals.declineCode = pick(codes, u3);
    }
    if (leak === "abandoned_checkout") {
      base.signals.dropReason = pick(
        ["price_shock", "checkout_friction", "payment_page_drop"],
        u2,
      );
      base.signals.cartItems = ["Demo cart item"];
    }
    if (leak === "failed_subscription") {
      base.signals.subReason = pick(
        ["retry_exhausted", "expired_card", "mandate_revoked", "forgotten_renewal"],
        u1,
      );
    }
    if (leak === "overdue_invoice") {
      base.signals.invoiceNo = `INV-${9000 + i}`;
      base.signals.daysPastDue = Math.floor(5 + u3 * 75);
      base.signals.invoiceReason = pick(
        ["cashflow_delay", "dispute_unaware", "forgotten_renewal"],
        u2,
      );
      base.customer.company = `${name} Traders`;
    }

    out.push(base);
  }
  return out;
}
