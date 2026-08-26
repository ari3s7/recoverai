"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { inr, LEAK_LABEL } from "@/lib/format";
import type { CaseActionRequest, CaseStatus, LeakType, RunCase } from "@/lib/types";
import { CaseDrawer } from "./case-drawer";
import { CaseTable } from "./case-table";
import { loadWorkspace, mergeCase, readSse, type WorkspaceView } from "./workspace";

const LEAK_FILTERS: Array<{ id: "all" | LeakType; label: string }> = [
  { id: "all", label: "All" },
  { id: "payment_failure", label: "Payments" },
  { id: "abandoned_checkout", label: "Checkout" },
  { id: "failed_subscription", label: "Subs" },
  { id: "overdue_invoice", label: "Invoices" },
];

const STATUS_FILTERS: Array<{ id: "all" | CaseStatus; label: string }> = [
  { id: "all", label: "Any status" },
  { id: "at_risk", label: "At risk" },
  { id: "recovered", label: "Recovered" },
  { id: "stopped", label: "Stopped" },
  { id: "escalated", label: "Escalated" },
  { id: "promised", label: "Promised" },
  { id: "held", label: "Held" },
];

export function CommandCenter() {
  const [view, setView] = useState<WorkspaceView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [liveLine, setLiveLine] = useState("Idle · waiting for a batch");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [leak, setLeak] = useState<"all" | LeakType>("all");
  const [status, setStatus] = useState<"all" | CaseStatus>("all");
  const [q, setQ] = useState("");
  const [webhook, setWebhook] = useState(
    '{\n  "type": "payment.failed",\n  "amountInr": 2199,\n  "customer": { "name": "Ira Sen", "city": "Pune" },\n  "declineCode": "INSUFFICIENT_FUNDS"\n}',
  );
  const [ingestMsg, setIngestMsg] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const next = await loadWorkspace();
    setView(next);
    return next;
  }, []);

  useEffect(() => {
    reload().catch((err: unknown) => setError(err instanceof Error ? err.message : "Load failed"));
  }, [reload]);

  const selected = view?.cases.find((c) => c.id === selectedId) ?? null;

  const filtered = useMemo(() => {
    if (!view) return [];
    return view.cases.filter((c) => {
      if (leak !== "all" && c.leakType !== leak) return false;
      if (status !== "all" && c.status !== status) return false;
      if (q) {
        const hay = `${c.id} ${c.customer.name} ${c.customer.company ?? ""} ${c.customer.city}`.toLowerCase();
        if (!hay.includes(q.toLowerCase())) return false;
      }
      return true;
    });
  }, [view, leak, status, q]);

  async function runBatch() {
    if (running) return;
    setRunning(true);
    setError(null);
    setLiveLine("Detect → diagnose → policy → act");
    try {
      const res = await fetch("/api/batch/run", { method: "POST" });
      if (!res.ok) throw new Error("Batch failed to start");
      await readSse(res, (event) => {
        const type = event.type as string;
        if (type === "start") {
          setLiveLine(`Running ${event.caseCount as number} eligible cases`);
        }
        if (type === "case") {
          const cse = event.case as RunCase;
          setView((prev) => (prev ? mergeCase(prev, cse) : prev));
          setLiveLine(`${cse.id} · ${cse.play?.label ?? cse.status} · ${cse.status}`);
        }
        if (type === "done") {
          setLiveLine("Batch complete · audit sealed");
        }
      });
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Batch failed");
    } finally {
      setRunning(false);
    }
  }

  async function onAction(id: string, action: CaseActionRequest) {
    const res = await fetch(`/api/cases/${id}/actions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(action),
    });
    const data = (await res.json()) as WorkspaceView & { error?: string; case?: RunCase };
    if (!res.ok) {
      setError(data.error ?? "Action failed");
      return;
    }
    setView(data);
  }

  async function resetDesk() {
    if (!confirm("Reset the Nivaara workspace back to the seeded 48 cases?")) return;
    const res = await fetch("/api/workspace/reset", { method: "POST" });
    setView((await res.json()) as WorkspaceView);
    setSelectedId(null);
    setLiveLine("Workspace reset to seed");
  }

  async function ingestWebhook() {
    setIngestMsg(null);
    const res = await fetch("/api/ingest/webhook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: webhook,
    });
    const data = (await res.json()) as WorkspaceView & { error?: string; case?: RunCase };
    if (!res.ok) {
      setIngestMsg(data.error ?? "Ingest failed");
      return;
    }
    setView(data);
    setSelectedId(data.case?.id ?? null);
    setIngestMsg(`Ingested ${data.case?.id}`);
  }

  async function ingestCsv(file: File) {
    const body = new FormData();
    body.set("file", file);
    const res = await fetch("/api/ingest/csv", { method: "POST", body });
    const data = (await res.json()) as WorkspaceView & { error?: string };
    if (!res.ok) {
      setIngestMsg(data.error ?? "CSV import failed");
      return;
    }
    setView(data);
    setIngestMsg("CSV imported");
  }

  if (!view) {
    return (
      <div className="p-8 text-sm text-muted">{error ? error : "Loading collections desk…"}</div>
    );
  }

  const t = view.totals;
  const leakMix = (["payment_failure", "abandoned_checkout", "failed_subscription", "overdue_invoice"] as LeakType[]).map(
    (id) => {
      const subset = view.cases.filter((c) => c.leakType === id);
      const amount = subset.reduce((s, c) => s + c.amountInr, 0);
      return { id, amount, count: subset.length };
    },
  );
  const maxMix = Math.max(...leakMix.map((x) => x.amount), 1);

  return (
    <div className="p-5 space-y-5">
      {error ? (
        <div className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</div>
      ) : null}

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Command center</h1>
          <p className="text-sm text-muted mt-1">
            Detect revenue at risk, bound the play with policy, execute, measure rupees recovered.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={resetDesk}
            className="rounded-md border border-line px-3 py-2 text-sm text-muted hover:text-foreground"
          >
            Reset workspace
          </button>
          <button
            onClick={runBatch}
            disabled={running}
            className="rounded-md bg-gold text-background px-4 py-2 text-sm font-medium disabled:opacity-50"
          >
            {running ? "Running batch…" : "Run recovery batch"}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
        <Kpi label="Exposure" value={inr(t.exposureInr)} />
        <Kpi label="Recovered" value={inr(t.recoveredInr)} gold />
        <Kpi label="Recovery rate" value={`${Math.round(t.recoveryRate * 100)}%`} gold />
        <Kpi label="Promised" value={inr(t.promisedInr)} />
        <Kpi label="Stopped" value={String(t.stoppedCount)} />
        <Kpi label="Escalated" value={String(t.escalatedCount)} />
      </div>

      <div className="grid lg:grid-cols-[1fr_320px] gap-4">
        <section className="rounded-lg border border-line bg-panel overflow-hidden">
          <div className="px-4 py-3 border-b border-line flex flex-wrap items-center gap-2">
            <div className="text-xs uppercase tracking-wide text-muted mr-2">Pipeline</div>
            {["Detect", "Diagnose", "Policy", "Act", "Audit"].map((step, i) => (
              <span
                key={step}
                className={`text-xs px-2 py-1 rounded ${running ? "text-gold border border-gold/30" : "text-muted border border-line"}`}
              >
                {i + 1} {step}
              </span>
            ))}
            <span className="ml-auto text-xs text-muted">{liveLine}</span>
          </div>

          <div className="px-4 py-3 border-b border-line grid sm:grid-cols-4 gap-3">
            {leakMix.map((row) => (
              <button
                key={row.id}
                onClick={() => setLeak(row.id === leak ? "all" : row.id)}
                className="text-left"
              >
                <div className="text-[11px] uppercase tracking-wide text-muted">{LEAK_LABEL[row.id]}</div>
                <div className="text-sm tabular mt-1">{inr(row.amount)}</div>
                <div className="h-1 bg-white/5 mt-2 rounded">
                  <div className="h-1 rounded bg-gold/70" style={{ width: `${(row.amount / maxMix) * 100}%` }} />
                </div>
                <div className="text-[11px] text-muted mt-1">{row.count} cases</div>
              </button>
            ))}
          </div>

          <div className="px-3 py-2 border-b border-line flex flex-wrap gap-2 items-center">
            {LEAK_FILTERS.map((f) => (
              <FilterChip key={f.id} active={leak === f.id} onClick={() => setLeak(f.id)}>
                {f.label}
              </FilterChip>
            ))}
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as typeof status)}
              className="ml-auto bg-background border border-line rounded px-2 py-1 text-xs"
            >
              {STATUS_FILTERS.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </select>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search name or ID"
              className="bg-background border border-line rounded px-2 py-1 text-xs w-40"
            />
          </div>

          <CaseTable cases={filtered} selectedId={selectedId} onOpen={setSelectedId} />
        </section>

        <aside className="space-y-4">
          <section className="rounded-lg border border-line bg-panel p-4">
            <div className="text-[11px] uppercase tracking-wide text-muted">Live audit</div>
            <ol className="mt-3 space-y-3 max-h-[360px] overflow-y-auto">
              {view.audit.slice(0, 18).map((ev) => (
                <li key={ev.id}>
                  <button
                    className="text-left w-full"
                    onClick={() => ev.caseId !== "SYSTEM" && setSelectedId(ev.caseId)}
                  >
                    <div className="font-mono text-[10px] text-gold-dim">
                      {ev.caseId} · {ev.actor} · {ev.action}
                    </div>
                    <div className="text-xs text-muted mt-0.5">{ev.reason}</div>
                  </button>
                </li>
              ))}
            </ol>
          </section>

          <section className="rounded-lg border border-line bg-panel p-4 space-y-3">
            <div className="text-[11px] uppercase tracking-wide text-muted">Ingest</div>
            <p className="text-xs text-muted">
              POST /api/ingest/webhook or drop a CSV. New cases land as at-risk and wait for the next batch.
            </p>
            <textarea
              value={webhook}
              onChange={(e) => setWebhook(e.target.value)}
              rows={7}
              className="w-full bg-background border border-line rounded p-2 font-mono text-[11px]"
            />
            <div className="flex flex-wrap gap-2">
              <button onClick={ingestWebhook} className="text-xs border border-line rounded px-2 py-1 hover:border-gold/50">
                Ingest event
              </button>
              <label className="text-xs border border-line rounded px-2 py-1 hover:border-gold/50 cursor-pointer">
                Upload CSV
                <input
                  type="file"
                  accept=".csv,text/csv"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void ingestCsv(file);
                  }}
                />
              </label>
              <a href="/sample-cases.csv" className="text-xs text-muted hover:text-gold px-1 py-1">
                sample.csv
              </a>
            </div>
            {ingestMsg ? <p className="text-xs text-ok">{ingestMsg}</p> : null}
          </section>
        </aside>
      </div>

      <CaseDrawer
        cse={selected}
        llmConfigured={view.llmConfigured}
        busy={running}
        onClose={() => setSelectedId(null)}
        onAction={onAction}
      />
    </div>
  );
}

function Kpi({ label, value, gold }: { label: string; value: string; gold?: boolean }) {
  return (
    <div className="rounded-lg border border-line bg-panel px-4 py-3">
      <div className="text-[11px] uppercase tracking-wide text-muted">{label}</div>
      <div className={`mt-1 text-xl tabular ${gold ? "text-gold" : ""}`}>{value}</div>
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`text-xs px-2.5 py-1 rounded-full border ${
        active ? "border-gold/50 text-gold bg-gold/10" : "border-line text-muted"
      }`}
    >
      {children}
    </button>
  );
}
