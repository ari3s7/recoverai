"use client";

import { useCallback, useState } from "react";
import { inr, LEAK_LABEL } from "@/lib/format";
import type { EvaluationReport } from "@/lib/types";

export default function EvaluationPage() {
  const [report, setReport] = useState<EvaluationReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [dataset, setDataset] = useState<"seed" | "synthetic">("synthetic");
  const [count, setCount] = useState(2000);

  const run = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/evaluation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dataset, syntheticCount: count }),
      });
      setReport((await res.json()) as EvaluationReport);
    } finally {
      setLoading(false);
    }
  }, [dataset, count]);

  const b = report?.baseline;
  const a = report?.agent;

  return (
    <div className="p-5 space-y-5 max-w-5xl">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-gold">Recovery evaluation</h1>
        <p className="text-sm text-muted mt-1">
          Baseline (blind retry / generic reminder) vs RecoverAI (scored play selection + mandate sequencer).
          Numbers are calculated from the same ground-truth simulator — not marketing copy.
          AI predicted probability is not counted as recovered revenue.
        </p>
      </div>

      <div className="flex flex-wrap gap-3 items-end">
        <label className="text-sm">
          Dataset
          <select
            value={dataset}
            onChange={(e) => setDataset(e.target.value as "seed" | "synthetic")}
            className="mt-1 block bg-panel border border-line rounded px-2 py-1.5"
          >
            <option value="synthetic">Synthetic ({count} cases)</option>
            <option value="seed">Demo seed (48 cases)</option>
          </select>
        </label>
        {dataset === "synthetic" ? (
          <label className="text-sm">
            Case count
            <input
              type="number"
              min={100}
              max={5000}
              value={count}
              onChange={(e) => setCount(Number(e.target.value))}
              className="mt-1 block w-28 bg-panel border border-line rounded px-2 py-1.5"
            />
          </label>
        ) : null}
        <button
          onClick={run}
          disabled={loading}
          className="glow rounded-md bg-gold text-background px-4 py-2 text-sm font-medium disabled:opacity-50"
        >
          {loading ? "Running…" : "Run evaluation"}
        </button>
      </div>

      {report && b && a ? (
        <>
          <div className="grid sm:grid-cols-3 gap-3">
            <Metric label="Baseline recovered" value={inr(b.recoveredInr)} />
            <Metric label="RecoverAI recovered" value={inr(a.recoveredInr)} gold />
            <Metric
              label="Incremental lift"
              value={`${inr(report.incrementalRecoveredInr)} (${report.recoveryLiftPct.toFixed(1)}%)`}
              gold
            />
          </div>

          <div className="rounded-lg border border-line bg-panel overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-[11px] uppercase text-muted border-b border-line">
                <tr>
                  <th className="px-3 py-2 text-left">Metric</th>
                  <th className="px-3 py-2 text-right">Baseline</th>
                  <th className="px-3 py-2 text-right">RecoverAI</th>
                </tr>
              </thead>
              <tbody>
                <Row label="Cases" b={String(report.caseCount)} a={String(report.caseCount)} />
                <Row label="Exposure" b={inr(b.exposureInr)} a={inr(a.exposureInr)} />
                <Row label="Recovery rate" b={`${Math.round(b.recoveryRate * 100)}%`} a={`${Math.round(a.recoveryRate * 100)}%`} />
                <Row label="Recovered count" b={String(b.recoveredCount)} a={String(a.recoveredCount)} />
                <Row label="Actions taken" b={String(b.actionCount)} a={String(a.actionCount)} />
                <Row label="Actions / recovery" b={b.actionsPerRecovery.toFixed(2)} a={a.actionsPerRecovery.toFixed(2)} />
                <Row label="Stopped" b={String(b.stoppedCount)} a={String(a.stoppedCount)} />
                <Row label="Escalated" b={String(b.escalatedCount)} a={String(a.escalatedCount)} />
                <Row label="Promises created" b={String(b.promisedCount)} a={String(a.promisedCount)} />
                <Row label="Promises fulfilled" b={String(b.promisedFulfilledCount)} a={String(a.promisedFulfilledCount)} />
              </tbody>
            </table>
          </div>

          <section>
            <h2 className="text-sm font-medium mb-2">By workflow</h2>
            <div className="grid sm:grid-cols-2 gap-2 text-xs">
              {(Object.keys(b.byLeak) as (keyof typeof b.byLeak)[]).map((leak) => (
                <div key={leak} className="border border-line rounded p-3 bg-panel">
                  <div className="text-muted uppercase tracking-wide">{LEAK_LABEL[leak]}</div>
                  <div className="mt-1">
                    Baseline {inr(b.byLeak[leak].recoveredInr)} · Agent{" "}
                    <span className="text-gold">{inr(a.byLeak[leak].recoveredInr)}</span>
                  </div>
                  <div className="text-muted">{b.byLeak[leak].count} cases</div>
                </div>
              ))}
            </div>
          </section>

          <p className="text-xs text-muted">
            Ran {report.caseCount} {report.dataset} cases at {new Date(report.ranAt).toLocaleString("en-IN")}.
            Settlement uses a hidden ground-truth model; the AI never sees it. Razorpay captures are verified
            separately via webhook.
          </p>
        </>
      ) : loading ? (
        <p className="text-sm text-muted">Computing baseline vs RecoverAI…</p>
      ) : (
        <p className="text-sm text-muted">
          Choose a dataset and run the experiment. Metrics are calculated live — nothing is hardcoded.
        </p>
      )}
    </div>
  );
}

function Metric({ label, value, gold }: { label: string; value: string; gold?: boolean }) {
  return (
    <div className="rounded-lg border border-line bg-panel px-4 py-3">
      <div className="text-[11px] uppercase tracking-wide text-muted">{label}</div>
      <div className={`mt-1 text-xl tabular ${gold ? "text-gold" : ""}`}>{value}</div>
    </div>
  );
}

function Row({ label, b, a }: { label: string; b: string; a: string }) {
  return (
    <tr className="border-b border-line/70">
      <td className="px-3 py-2 text-muted">{label}</td>
      <td className="px-3 py-2 text-right tabular">{b}</td>
      <td className="px-3 py-2 text-right tabular text-gold">{a}</td>
    </tr>
  );
}
