import type { PolicyConfig } from "../types";

export const DEFAULT_POLICY: PolicyConfig = {
  maxContactsPer7Days: 3,
  quietHoursStart: 21,
  quietHoursEnd: 9,
  highAovInr: 25_000,
  b2bEscalateDpd: 60,
  maxRetries: 3,
  maxMandateRetries: 2,
  recoveryWindowDays: 14,
  mandateRetryCooldownHours: 24,
  timezone: "Asia/Kolkata",
  autoExecute: true,
  sandboxClock: true,
  sandboxClockIso: "2026-08-26T16:30:00+05:30",
};

export function normalizePolicy(partial?: Partial<PolicyConfig> | null): PolicyConfig {
  return { ...DEFAULT_POLICY, ...partial, timezone: "Asia/Kolkata" };
}

export function policyNow(policy: PolicyConfig, fallback = new Date()): Date {
  if (policy.sandboxClock) return new Date(policy.sandboxClockIso);
  return fallback;
}
