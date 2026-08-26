import type { SeedCase } from "../types";

function ptpDate(seed: SeedCase): Date | null {
  const raw = seed.signals.promiseToPayDate;
  if (!raw) return null;
  const d = new Date(`${raw}T00:00:00+05:30`);
  return Number.isFinite(d.getTime()) ? d : null;
}

export function isActivePromise(seed: SeedCase, at: Date): boolean {
  const ptp = ptpDate(seed);
  return Boolean(ptp && ptp.getTime() > at.getTime());
}

export function isBreachedPromise(seed: SeedCase, at: Date): boolean {
  const ptp = ptpDate(seed);
  return Boolean(ptp && ptp.getTime() <= at.getTime());
}
