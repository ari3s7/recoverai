import { policyNow } from "../policy/defaults";
import type { AuditEvent, PolicyConfig, RunCase } from "../types";
import { evaluatePolicy } from "./policy";
import { processCase } from "./process";

export function isBatchEligible(c: RunCase, policy?: PolicyConfig): boolean {
  if (c.status === "recovered" || c.status === "stopped" || c.status === "escalated" || c.status === "promised") {
    return false;
  }
  if (c.status === "held") {
    if (!policy) return !c.lastBatchId;
    const verdict = evaluatePolicy(c, policy, policyNow(policy));
    return verdict.action !== "hold";
  }
  if (c.lastBatchId) return false;
  return c.status === "at_risk" || c.status === "in_flight";
}

export async function runBatch(cases: RunCase[], policy: PolicyConfig, batchId: string): Promise<{
  cases: RunCase[];
  events: AuditEvent[];
  processed: RunCase[];
}> {
  const now = policyNow(policy);
  const events: AuditEvent[] = [];
  const processed: RunCase[] = [];
  const next: RunCase[] = [];
  for (const c of cases) {
    if (!isBatchEligible(c, policy)) {
      next.push(c);
      continue;
    }
    try {
      const updated = await processCase({ ...c, status: "in_flight" }, policy, now);
      const withBatch = { ...updated, lastBatchId: batchId };
      const fresh = withBatch.timeline.slice(c.timeline.length);
      events.push(...fresh);
      processed.push(withBatch);
      next.push(withBatch);
    } catch {
      next.push(c);
    }
  }
  return { cases: next, events, processed };
}
