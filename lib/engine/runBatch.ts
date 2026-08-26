import { policyNow } from "../policy/defaults";
import type { AuditEvent, PolicyConfig, RunCase } from "../types";
import { processCase } from "./process";

export function isBatchEligible(c: RunCase): boolean {
  if (c.status === "recovered" || c.status === "stopped" || c.status === "escalated" || c.status === "promised") {
    return false;
  }
  if (c.lastBatchId && c.status !== "held") return false;
  return c.status === "at_risk" || c.status === "held" || c.status === "in_flight";
}

export function runBatch(cases: RunCase[], policy: PolicyConfig, batchId: string): {
  cases: RunCase[];
  events: AuditEvent[];
  processed: RunCase[];
} {
  const now = policyNow(policy);
  const events: AuditEvent[] = [];
  const processed: RunCase[] = [];
  const next = cases.map((c) => {
    if (!isBatchEligible(c)) return c;
    const updated = processCase({ ...c, status: "in_flight" }, policy, now);
    const withBatch = { ...updated, lastBatchId: batchId };
    const fresh = withBatch.timeline.slice(c.timeline.length);
    events.push(...fresh);
    processed.push(withBatch);
    return withBatch;
  });
  return { cases: next, events, processed };
}
