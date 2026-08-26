import type { PolicyConfig, RunCase, SeedCase } from "../lib/types";
import { DEFAULT_POLICY } from "../lib/policy/defaults";

export function asRunCase(seed: SeedCase): RunCase {
  return {
    ...seed,
    signals: { ...seed.signals, flags: [...seed.signals.flags] },
    status: "at_risk",
    timeline: [],
    updatedAt: seed.occurredAt,
  };
}

export function withPolicy(over: Partial<PolicyConfig> = {}): PolicyConfig {
  return { ...DEFAULT_POLICY, ...over };
}

export function byName(cases: SeedCase[], name: string): SeedCase {
  const found = cases.find((c) => c.customer.name === name || c.customer.company === name);
  if (!found) throw new Error(`missing seed ${name}`);
  return found;
}
