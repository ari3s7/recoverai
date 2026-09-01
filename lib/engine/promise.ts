import type { RunCase, SeedCase } from "../types";

function ptpDate(seed: SeedCase): Date | null {
  const raw = seed.signals.promiseToPayDate;
  if (!raw) return null;
  const d = new Date(`${raw}T00:00:00+05:30`);
  return Number.isFinite(d.getTime()) ? d : null;
}

export function isValidPromiseDate(raw: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return false;
  const d = new Date(`${raw}T00:00:00+05:30`);
  return Number.isFinite(d.getTime());
}

export function isActivePromise(seed: SeedCase, at: Date): boolean {
  const ptp = ptpDate(seed);
  return Boolean(ptp && ptp.getTime() > at.getTime());
}

export function isBreachedPromise(seed: SeedCase, at: Date): boolean {
  const ptp = ptpDate(seed);
  return Boolean(ptp && ptp.getTime() <= at.getTime());
}

export function istCalendarDate(at: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

export type PromiseLifecycleState = "none" | "promised" | "due" | "fulfilled" | "broken";

export type PromiseLifecycle = {
  state: PromiseLifecycleState;
  promisedDate?: string;
  recoveredInr: number;
  eligibleForRerun: boolean;
};

function hadPromise(cse: RunCase): boolean {
  return Boolean(
    cse.signals.promiseToPayDate ||
      cse.outcome?.promisedDate ||
      cse.status === "promised" ||
      cse.play?.id === "promise_to_pay" ||
      cse.timeline.some((e) => e.action === "operator.promise"),
  );
}

export function describePromiseLifecycle(cse: RunCase, at: Date): PromiseLifecycle {
  const promisedDate = cse.signals.promiseToPayDate ?? cse.outcome?.promisedDate;
  const recoveredInr = cse.outcome?.recoveredInr ?? 0;

  if (!hadPromise(cse)) {
    return { state: "none", recoveredInr: 0, eligibleForRerun: false };
  }

  if (cse.status === "recovered" && recoveredInr > 0) {
    return {
      state: "fulfilled",
      promisedDate,
      recoveredInr,
      eligibleForRerun: false,
    };
  }

  if (promisedDate && isActivePromise({ ...cse, signals: { ...cse.signals, promiseToPayDate: promisedDate } }, at)) {
    return {
      state: "promised",
      promisedDate,
      recoveredInr: 0,
      eligibleForRerun: false,
    };
  }

  if (promisedDate && promisedDate === istCalendarDate(at)) {
    return {
      state: "due",
      promisedDate,
      recoveredInr: 0,
      eligibleForRerun: true,
    };
  }

  return {
    state: "broken",
    promisedDate,
    recoveredInr: 0,
    eligibleForRerun: true,
  };
}
