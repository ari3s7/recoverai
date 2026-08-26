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
  const p = report?.policy;

  return (
    <div className="p-5 space-y-5 max-w-5xl">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-gold">Paired evaluation</h1>
        <p className="text-sm text-muted mt-1">
          Paired deterministic synthetic evaluation. Baseline vs{" "}
          <strong className="text-foreground">RecoverAI Recovery Policy</strong> on the same cases and the same
          latent customer outcome. Bulk benchmark: LLM calls: 0. Ground truth is synthetic and hidden from the
          agent. Live OpenAI/Gemini decisions are a separate per-case action on the desk.
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
            <option value="synthetic">Synthetic evaluation ({count} cases)</option>
            <option value="seed">Live demo seed (48 curated cases)</option>
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
          {loading ? "Running…" : "Run paired experiment"}
        </button>
      </div>

      {report && b && p ? (
        <>
          <p className="text-xs text-muted">
            Mode: {report.decisionMode} · LLM calls: {report.llmCalls} · Paired latent outcomes:{" "}
            {report.paired ? "yes" : "no"} · {report.dataset} ·{" "}
            {new Date(report.ranAt).toLocaleString("en-IN")}
          </p>

          <div className="grid sm:grid-cols-3 gap-3">
            <Metric label="Baseline recovered" value={inr(b.recoveredInr)} />
            <Metric label="RecoverAI Recovery Policy" value={inr(p.recoveredInr)} gold />
            <Metric
              label="Incremental / lift"
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
                  <th className="px-3 py-2 text-right">RecoverAI policy</th>
                </tr>
              </thead>
              <tbody>
                <Row label="Cases" b={String(report.caseCount)} a={String(report.caseCount)} />
                <Row label="Revenue at risk" b={inr(b.exposureInr)} a={inr(p.exposureInr)} />
                <Row
                  label="Recovery rate"
                  b={`${(b.recoveryRate * 100).toFixed(1)}%`}
                  a={`${(p.recoveryRate * 100).toFixed(1)}%`}
                />
                <Row label="Successful recoveries" b={String(b.recoveredCount)} a={String(p.recoveredCount)} />
                <Row label="Actions" b={String(b.actionCount)} a={String(p.actionCount)} />
                <Row label="Actions / recovery" b={b.actionsPerRecovery.toFixed(2)} a={p.actionsPerRecovery.toFixed(2)} />
                <Row label="Stopped" b={String(b.stoppedCount)} a={String(p.stoppedCount)} />
                <Row label="Escalated" b={String(b.escalatedCount)} a={String(p.escalatedCount)} />
                <Row label="Promises created" b={String(b.promisedCount)} a={String(p.promisedCount)} />
                <Row
                  label="Promises fulfilled"
                  b={String(b.promisedFulfilledCount)}
                  a={String(p.promisedFulfilledCount)}
                />
                <Row
                  label="Avg predicted P (policy)"
                  b="—"
                  a={`${Math.round(p.avgPredictedProbability * 100)}%`}
                />
              </tbody>
            </table>
          </div>

          <div className="grid sm:grid-cols-3 gap-3 text-sm">
            <Metric
              label="Recovery-rate lift"
              value={`${report.recoveryRateLiftPct.toFixed(1)}%`}
              gold
            />
            <Metric
              label="Actions/recovery delta"
              value={report.actionEfficiencyDelta.toFixed(2)}
            />
            <Metric label="Escalation delta" value={String(report.escalationDelta)} />
          </div>

          <section>
            <h2 className="text-sm font-medium mb-2">Prediction calibration (RecoverAI policy vs actual)</h2>
            <p className="text-xs text-muted mb-2">
              Predicted probability is the strategy score, not the hidden ground-truth model. Brier score{" "}
              {report.brierScore.toFixed(3)} (lower is better).
            </p>
            <div className="rounded-lg border border-line bg-panel overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-[11px] uppercase text-muted border-b border-line">
                  <tr>
                    <th className="px-3 py-2 text-left">Predicted bucket</th>
                    <th className="px-3 py-2 text-right">Cases</th>
                    <th className="px-3 py-2 text-right">Avg predicted</th>
                    <th className="px-3 py-2 text-right">Actual recovery</th>
                  </tr>
                </thead>
                <tbody>
                  {report.calibration.map((row) => (
                    <tr key={row.bucket} className="border-b border-line/70">
                      <td className="px-3 py-2 text-muted">{row.bucket}</td>
                      <td className="px-3 py-2 text-right tabular">{row.count}</td>
                      <td className="px-3 py-2 text-right tabular">{Math.round(row.avgPredicted * 100)}%</td>
                      <td className="px-3 py-2 text-right tabular text-gold">
                        {Math.round(row.actualRecoveryRate * 100)}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section>
            <h2 className="text-sm font-medium mb-2">By workflow</h2>
            <div className="grid sm:grid-cols-2 gap-2 text-xs">
              {(Object.keys(b.byLeak) as (keyof typeof b.byLeak)[]).map((leak) => (
                <div key={leak} className="border border-line rounded p-3 bg-panel">
                  <div className="text-muted uppercase tracking-wide">{LEAK_LABEL[leak]}</div>
                  <div className="mt-1">
                    Baseline {inr(b.byLeak[leak].recoveredInr)} · Policy{" "}
                    <span className="text-gold">{inr(p.byLeak[leak].recoveredInr)}</span>
                  </div>
                  <div className="text-muted">{b.byLeak[leak].count} cases</div>
                </div>
              ))}
            </div>
          </section>

          <p className="text-xs text-muted">
            Synthetic evaluation is not real merchant performance. Ground truth is hidden from the agent. Razorpay
            captures are verified separately via webhook and are not this simulator. Curated demo cases live on
            Command; this page is the experiment.
          </p>
        </>
      ) : loading ? (
        <p className="text-sm text-muted">Running paired baseline vs RecoverAI Recovery Policy…</p>
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
