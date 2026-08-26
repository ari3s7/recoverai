import { inr } from "../format";
import { policyNow } from "../policy/defaults";
import type { PolicyConfig, PolicyVerdict, SeedCase } from "../types";

function hourInTz(date: Date, timeZone: string): number {
  const hour = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    hour12: false,
  }).format(date);
  return Number(hour);
}

export function isQuietHours(policy: PolicyConfig, at: Date): boolean {
  const hour = hourInTz(at, policy.timezone);
  const { quietHoursStart: start, quietHoursEnd: end } = policy;
  if (start === end) return false;
  if (start > end) return hour >= start || hour < end;
  return hour >= start && hour < end;
}

export function evaluatePolicy(seed: SeedCase, policy: PolicyConfig, at?: Date): PolicyVerdict {
  const now = at ?? policyNow(policy);
  const flags = seed.signals.flags;

  if (flags.includes("legal")) {
    return {
      allowed: false,
      action: "stop",
      ruleId: "legal-hold",
      reason: "Legal flag is set. No outbound recovery. Route to counsel.",
    };
  }
  if (flags.includes("dnc")) {
    return {
      allowed: false,
      action: "stop",
      ruleId: "dnc",
      reason: "Do-not-contact. All automated channels are blocked.",
    };
  }
  if (flags.includes("complaint")) {
    return {
      allowed: false,
      action: "stop",
      ruleId: "complaint",
      reason: "Prior complaint on file. Automation stops; a human may reopen only after review.",
    };
  }
  if (flags.includes("fraud") || flags.includes("chargeback")) {
    return {
      allowed: false,
      action: "stop",
      ruleId: "fraud-chargeback",
      reason: flags.includes("fraud")
        ? "Fraud signal. Do not retry the instrument or place a collections call."
        : "Chargeback open. Retrying the debit is a scheme violation.",
    };
  }
  if (seed.signals.promiseToPayDate) {
    const ptp = new Date(`${seed.signals.promiseToPayDate}T00:00:00+05:30`);
    if (ptp.getTime() > now.getTime()) {
      return {
        allowed: false,
        action: "hold",
        ruleId: "promise-to-pay",
        reason: `Active promise-to-pay until ${seed.signals.promiseToPayDate}. Hold all chases.`,
      };
    }
  }
  if (seed.signals.contactsLast7Days >= policy.maxContactsPer7Days) {
    return {
      allowed: false,
      action: "stop",
      ruleId: "contact-cap",
      reason: `Contact cap hit (${seed.signals.contactsLast7Days}/${policy.maxContactsPer7Days} in 7 days).`,
    };
  }
  if (flags.includes("quiet_hours") || isQuietHours(policy, now)) {
    const quiet = flags.includes("quiet_hours")
      ? "Customer is inside their quiet window."
      : `Quiet hours ${String(policy.quietHoursStart).padStart(2, "0")}:00–${String(policy.quietHoursEnd).padStart(2, "0")}:00 ${policy.timezone}.`;
    return {
      allowed: false,
      action: "hold",
      ruleId: "quiet-hours",
      reason: `${quiet} Defer outbound contact.`,
    };
  }
  if (
    seed.amountInr >= policy.highAovInr ||
    flags.includes("high_aov") ||
    (seed.merchantSegment === "b2b" && (seed.signals.daysPastDue ?? 0) >= policy.b2bEscalateDpd)
  ) {
    const why =
      seed.merchantSegment === "b2b" && (seed.signals.daysPastDue ?? 0) >= policy.b2bEscalateDpd
        ? `B2B invoice is ${seed.signals.daysPastDue} DPD (threshold ${policy.b2bEscalateDpd}).`
        : `Amount ${inr(seed.amountInr)} is at or above the human gate ${inr(policy.highAovInr)}.`;
    return {
      allowed: true,
      action: "escalate",
      ruleId: "human-gate",
      reason: `${why} No auto voice. Queue for an operator.`,
    };
  }
  return {
    allowed: true,
    action: "proceed",
    reason: "All stopping rules clear. Agent may execute a bounded play.",
  };
}
