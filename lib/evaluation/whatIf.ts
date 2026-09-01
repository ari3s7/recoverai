import { normalizePolicy } from "../policy/defaults";
import type { EvaluationReport, PolicyConfig } from "../types";
import { runEvaluation } from "./run";

export type WhatIfDelta = {
  recoveryRatePctPoints: number;
  recoveredInr: number;
  actionCount: number;
  escalatedCount: number;
  customerContactCount: number;
};

export type WhatIfReport = {
  kind: "whatif";
  simulated: true;
  savedPolicyUnchanged: true;
  dataset: "seed" | "synthetic";
  current: EvaluationReport;
  proposed: EvaluationReport;
  delta: WhatIfDelta;
};

export async function runWhatIf(opts: {
  currentPolicy: PolicyConfig;
  proposedPolicy: PolicyConfig | Partial<PolicyConfig>;
  dataset?: "seed" | "synthetic";
  syntheticCount?: number;
}): Promise<WhatIfReport> {
  const dataset = opts.dataset ?? "seed";
  const syntheticCount = opts.syntheticCount;
  const currentPolicy = normalizePolicy(opts.currentPolicy);
  const proposedPolicy = normalizePolicy({ ...currentPolicy, ...opts.proposedPolicy });
  const current = await runEvaluation({ dataset, syntheticCount, policy: currentPolicy });
  const proposed = await runEvaluation({ dataset, syntheticCount, policy: proposedPolicy });
  return {
    kind: "whatif",
    simulated: true,
    savedPolicyUnchanged: true,
    dataset,
    current,
    proposed,
    delta: {
      recoveryRatePctPoints: (proposed.policy.recoveryRate - current.policy.recoveryRate) * 100,
      recoveredInr: proposed.policy.recoveredInr - current.policy.recoveredInr,
      actionCount: proposed.policy.actionCount - current.policy.actionCount,
      escalatedCount: proposed.policy.escalatedCount - current.policy.escalatedCount,
      customerContactCount: proposed.policy.actionCount - current.policy.actionCount,
    },
  };
}
