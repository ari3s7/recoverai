import type { BatchTotals, CaseStatus, RunCase } from "../types";

export function emptyTotals(exposureInr: number): BatchTotals {
  return {
    exposureInr,
    recoveredInr: 0,
    promisedInr: 0,
    stillAtRiskInr: exposureInr,
    heldInr: 0,
    recoveredCount: 0,
    promisedCount: 0,
    stoppedCount: 0,
    escalatedCount: 0,
    heldCount: 0,
    processedCount: 0,
    recoveryRate: 0,
  };
}

export function computeTotals(cases: RunCase[]): BatchTotals {
  const exposureInr = cases.reduce((s, c) => s + c.amountInr, 0);
  const recoveredInr = cases.reduce((s, c) => s + (c.outcome?.recoveredInr ?? 0), 0);
  const promisedInr = cases.reduce((s, c) => s + (c.outcome?.promisedInr ?? 0), 0);
  const count = (status: CaseStatus) => cases.filter((c) => c.status === status).length;
  const heldInr = cases.filter((c) => c.status === "held").reduce((s, c) => s + c.amountInr, 0);
  const recoveredCount = count("recovered");
  const promisedCount = count("promised");
  const stoppedCount = count("stopped");
  const escalatedCount = count("escalated");
  const heldCount = count("held");
  const processedCount = cases.filter((c) => c.status !== "at_risk" && c.status !== "in_flight").length;
  const stillAtRiskInr = Math.max(0, exposureInr - recoveredInr - promisedInr);
  return {
    exposureInr,
    recoveredInr,
    promisedInr,
    stillAtRiskInr,
    heldInr,
    recoveredCount,
    promisedCount,
    stoppedCount,
    escalatedCount,
    heldCount,
    processedCount,
    recoveryRate: exposureInr === 0 ? 0 : recoveredInr / exposureInr,
  };
}
