import { PLAY_LABEL } from "../format";
import { policyNow } from "../policy/defaults";
import type { PlayId, PolicyConfig, RunCase } from "../types";
import { mandateCooldownActive } from "./mandate";
import { isQuietHours } from "./policy";
import { isActivePromise, isBreachedPromise } from "./promise";

export type PlannedAction = {
  at?: string;
  label: string;
  reason: string;
  playId?: PlayId;
  waitingOn: "quiet_hours" | "retry_cooldown" | "promise_date" | "recovery_window" | "human" | "contact_cap" | "none";
};

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function istParts(at: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
  }).formatToParts(at);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { y: get("year"), m: get("month"), d: get("day"), hour: get("hour") };
}

function istAtHour(y: number, m: number, d: number, hour: number): Date {
  return new Date(`${y}-${pad(m)}-${pad(d)}T${pad(hour)}:00:00+05:30`);
}

function addIstCalendarDays(y: number, m: number, d: number, days: number) {
  const noon = new Date(`${y}-${pad(m)}-${pad(d)}T12:00:00+05:30`);
  noon.setTime(noon.getTime() + days * 86_400_000);
  const next = istParts(noon, "Asia/Kolkata");
  return { y: next.y, m: next.m, d: next.d };
}

/** Next clock time the merchant quiet-hours window ends. Does not execute anything. */
export function nextQuietHoursEnd(policy: PolicyConfig, at: Date): Date {
  const tz = policy.timezone;
  const { y, m, d, hour } = istParts(at, tz);
  const end = policy.quietHoursEnd;
  const start = policy.quietHoursStart;
  const todayEnd = istAtHour(y, m, d, end);
  let until = todayEnd;
  if (start !== end && start > end) {
    if (hour >= start) {
      const n = addIstCalendarDays(y, m, d, 1);
      until = istAtHour(n.y, n.m, n.d, end);
    } else if (hour < end) {
      until = todayEnd;
    }
  } else if (start < end && hour >= end) {
    const n = addIstCalendarDays(y, m, d, 1);
    until = istAtHour(n.y, n.m, n.d, end);
  }
  if (until.getTime() <= at.getTime()) {
    const n = addIstCalendarDays(y, m, d, 1);
    until = istAtHour(n.y, n.m, n.d, end);
  }
  return until;
}

export function formatPlannedWhen(iso: string, now: Date, timeZone = "Asia/Kolkata"): string {
  const target = new Date(iso);
  const dayKey = (d: Date) =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(d);
  const today = dayKey(now);
  const tday = dayKey(target);
  const { y, m, d } = istParts(now, timeZone);
  const tom = addIstCalendarDays(y, m, d, 1);
  const tomorrow = `${tom.y}-${pad(tom.m)}-${pad(tom.d)}`;
  const time = new Intl.DateTimeFormat("en-IN", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(target);
  if (tday === today) return `Today · ${time}`;
  if (tday === tomorrow) return `Tomorrow · ${time}`;
  const date = new Intl.DateTimeFormat("en-IN", {
    timeZone,
    day: "2-digit",
    month: "short",
  }).format(target);
  return `${date} · ${time}`;
}

/**
 * Planned next eligible action. Presentation only — there is no scheduler.
 */
export function planNextAction(cse: RunCase, policy: PolicyConfig, at?: Date): PlannedAction | null {
  const now = at ?? policyNow(policy);
  const playId = cse.agent?.recommendedPlay ?? cse.play?.id;
  const playLabel = playId ? PLAY_LABEL[playId] : "Recovery play";

  if (cse.status === "recovered" && (cse.outcome?.recoveredInr ?? 0) > 0) {
    return null;
  }

  if (cse.policy?.ruleId === "recovery-window" || cse.policy?.ruleId === "dnc" || cse.policy?.ruleId === "legal-hold") {
    return {
      label: "No outbound",
      reason: cse.policy.reason,
      waitingOn: cse.policy.ruleId === "recovery-window" ? "recovery_window" : "none",
    };
  }

  if (cse.status === "stopped" && cse.policy?.action === "stop") {
    return {
      label: "Stopped",
      reason: cse.policy.reason,
      waitingOn: "none",
    };
  }

  if (cse.executionStatus === "queued" || cse.executionStatus === "escalated" || cse.status === "escalated") {
    return {
      label: "Human review",
      reason: cse.policy?.reason ?? cse.execution?.message ?? "Awaiting operator approval.",
      playId,
      waitingOn: "human",
    };
  }

  if (isActivePromise(cse, now) && cse.signals.promiseToPayDate) {
    const due = new Date(`${cse.signals.promiseToPayDate}T${pad(policy.quietHoursEnd)}:00:00+05:30`);
    return {
      at: due.toISOString(),
      label: playLabel,
      reason: `Promise date ${cse.signals.promiseToPayDate}. Hold until then.`,
      playId,
      waitingOn: "promise_date",
    };
  }

  if (isBreachedPromise(cse, now) && cse.status === "promised") {
    return {
      label: `Re-evaluate · ${playLabel}`,
      reason: "Promise is due or broken. Case may re-enter AI → policy → action.",
      playId,
      waitingOn: "none",
    };
  }

  const quietByClock = isQuietHours(policy, now);
  const quietByFlag = cse.signals.flags.includes("quiet_hours");
  if ((cse.policy?.ruleId === "quiet-hours" || quietByClock || quietByFlag) && cse.status !== "recovered") {
    const until = nextQuietHoursEnd(policy, now);
    return {
      at: until.toISOString(),
      label: playLabel,
      reason: quietByFlag
        ? `Customer quiet window. Merchant quiet hours end ${pad(policy.quietHoursEnd)}:00.`
        : `Quiet hours until ${pad(policy.quietHoursEnd)}:00.`,
      playId,
      waitingOn: "quiet_hours",
    };
  }

  if (mandateCooldownActive(cse, policy, now) && playId === "smart_retry") {
    const last = cse.signals.lastRetryAt ?? cse.signals.lastContactAt;
    if (last) {
      const ready = new Date(new Date(last).getTime() + policy.mandateRetryCooldownHours * 3_600_000);
      return {
        at: ready.toISOString(),
        label: playLabel,
        reason: `Retry cooldown ${policy.mandateRetryCooldownHours}h.`,
        playId,
        waitingOn: "retry_cooldown",
      };
    }
  }

  if (cse.signals.contactsLast7Days >= policy.maxContactsPer7Days) {
    const last = cse.signals.lastContactAt;
    return {
      at: last
        ? new Date(new Date(last).getTime() + 7 * 86_400_000).toISOString()
        : undefined,
      label: "No outbound",
      reason: `Contact cap reached: ${cse.signals.contactsLast7Days}/${policy.maxContactsPer7Days} contacts in 7 days.`,
      waitingOn: "contact_cap",
    };
  }

  if (cse.status === "held") {
    return {
      label: playLabel,
      reason: cse.policy?.reason ?? "Held. No outbound until the hold lifts.",
      playId,
      waitingOn: cse.policy?.ruleId === "quiet-hours" ? "quiet_hours" : "none",
    };
  }

  return null;
}
