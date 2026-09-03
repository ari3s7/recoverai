"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { inr, LEAK_LABEL, PLAY_LABEL } from "@/lib/format";
import { computeDeskAnalytics, computeRecoveryForecast } from "@/lib/engine/analytics";
import { policyNow } from "@/lib/policy/defaults";
import type { CaseActionRequest, CaseStatus, LeakType, PlayId, RunCase } from "@/lib/types";
import { auditActionShort, auditLane } from "./ui-copy";
import { CaseDrawer } from "./case-drawer";
import { CaseTable } from "./case-table";
import { loadWorkspace, mergeCase, readSse, type WorkspaceView } from "./workspace";

const LEAK_FILTERS: Array<{ id: "all" | LeakType; label: string }> = [
  { id: "all", label: "All" },
  { id: "payment_failure", label: "Payments" },
  { id: "abandoned_checkout", label: "Checkout" },
  { id: "failed_subscription", label: "Subs" },
  { id: "mandate_failure", label: "Mandates" },
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
  const [actionBusy, setActionBusy] = useState(false);
  const [liveLine, setLiveLine] = useState("Idle · waiting for a batch");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [leak, setLeak] = useState<"all" | LeakType>("all");
  const [status, setStatus] = useState<"all" | CaseStatus>("all");
  const [q, setQ] = useState("");
  const [webhook, setWebhook] = useState(
    '{\n  "type": "payment.failed",\n  "amountInr": 2199,\n  "customer": { "name": "Ira Sen", "city": "Pune" },\n  "declineCode": "INSUFFICIENT_FUNDS"\n}',
  );
  const [ingestMsg, setIngestMsg] = useState<string | null>(null);
  const [ingestBusy, setIngestBusy] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const next = await loadWorkspace();
    setView(next);
    return next;
  }, []);

  useEffect(() => {
    let cancelled = false;
    loadWorkspace()
      .then((next) => {
        if (!cancelled) setView(next);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Load failed");
      });
    return () => {
      cancelled = true;
    };
  }, []);

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
        setLiveLine("Analyzing case context…");
    try {
      const res = await fetch("/api/batch/run", { method: "POST" });
      if (!res.ok) throw new Error("Batch failed to start");
      await readSse(res, (event) => {
        const type = event.type as string;
        if (type === "start") {
          setLiveLine(`Checking merchant policy · ${event.caseCount as number} cases`);
        }
        if (type === "case") {
          const cse = event.case as RunCase;
          setView((prev) => (prev ? mergeCase(prev, cse) : prev));
          setLiveLine(`${cse.id} · ${cse.play?.label ?? cse.status} · ${cse.status}`);
        }
        if (type === "done") {
          setLiveLine("Batch complete · audit sealed");
        }
        if (type === "error") {
          setError((event.message as string) ?? "Batch error");
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
    setActionBusy(true);
    try {
      const res = await fetch(`/api/cases/${id}/actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action),
      });
      const data = (await res.json()) as WorkspaceView & { error?: string; case?: RunCase };
      if (!res.ok) {
        const message = data.error ?? "Action failed";
        setError(message);
        throw new Error(message);
      }
      setView(data);
    } finally {
      setActionBusy(false);
    }
  }

  async function resetDesk() {
    if (!confirm("Reset the Nivaara workspace back to the seeded 48 cases?")) return;
    const res = await fetch("/api/workspace/reset", { method: "POST" });
    const data = (await res.json()) as WorkspaceView & { error?: string };
    if (!res.ok) {
      setError(data.error ?? "Reset failed");
      return;
    }
    setView(data);
    setSelectedId(null);
    setLiveLine("Workspace reset to seed");
  }

  async function ingestWebhook() {
    setIngestMsg(null);
    setIngestBusy("Ingesting event…");
    try {
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
    } catch (err) {
      setIngestMsg(err instanceof Error ? err.message : "Ingest failed");
    } finally {
      setIngestBusy(null);
    }
  }

  async function ingestCsv(file: File) {
    setIngestBusy("Importing CSV…");
    setIngestMsg(null);
    try {
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
    } catch (err) {
      setIngestMsg(err instanceof Error ? err.message : "CSV import failed");
    } finally {
      setIngestBusy(null);
    }
  }

  if (!view) {
    return (
      <div className="p-8 text-sm text-muted">{error ? error : "Loading collections desk…"}</div>
    );
  }

  const t = view.totals;
  const now = policyNow(view.policy);
  const analytics = computeDeskAnalytics(view.cases, now);
  const forecast = computeRecoveryForecast(view.cases);
  const leakMix = (
    ["payment_failure", "abandoned_checkout", "failed_subscription", "mandate_failure", "overdue_invoice"] as LeakType[]
  ).map((id) => {
    const row = analytics.byLeak[id];
    return { id, amount: row.exposureInr, recovered: row.recoveredInr, count: row.count };
  });
  const maxMix = Math.max(...leakMix.map((x) => x.amount), 1);
  const playRows: PlayId[] = ["smart_retry", "payment_link", "hinglish_voice", "promise_to_pay", "human_escalate"];

  return (
    <div className="p-5 space-y-5 min-w-0 overflow-x-hidden">
      {error ? (
        <div className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</div>
      ) : null}

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">RecoverAI Command Center</h1>
          <p className="text-sm text-muted mt-1 max-w-2xl">
            RecoverAI identifies revenue at risk, recommends the best recovery action, checks it against merchant
            policy, executes only when authorized, and verifies actual money recovered.
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
            className="glow rounded-md bg-gold text-background px-4 py-2 text-sm font-medium disabled:opacity-50"
          >
            {running ? "Checking merchant policy…" : "Run recovery batch"}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <Kpi
          label="Verified recovered"
          value={inr(t.recoveredInr)}
          hint="Real money after capture, settlement, or operator confirmation"
          badge="Verified"
          gold
          hero
        />
        <Kpi label="Revenue at risk" value={inr(t.stillAtRiskInr)} hint="Open exposure · not recovered" />
        <Kpi label="Recovery rate" value={`${Math.round(t.recoveryRate * 100)}%`} hint="Verified recovered / exposure" />
        <Kpi label="Promised" value={inr(t.promisedInr)} hint="Parked · not recovered until paid" badge="Promised" />
        <Kpi label="Stopped" value={String(t.stoppedCount)} />
        <Kpi label="Escalated" value={String(t.escalatedCount)} />
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-3">
        <Kpi label="Actions / recovery" value={analytics.actionsPerRecovery ? analytics.actionsPerRecovery.toFixed(2) : "—"} />
        <Kpi label="Promises created" value={String(analytics.promisesCreated)} />
        <Kpi label="Promises fulfilled" value={String(analytics.promisesFulfilled)} />
        <Kpi label="Promises broken" value={String(analytics.promisesBroken)} />
        <Kpi label="Outbound actions" value={String(analytics.outboundActionCount)} />
      </div>

      <section className="rounded-lg border border-line bg-panel p-4">
        <div className="text-[11px] uppercase tracking-wide text-muted">Recovery forecast</div>
        <p className="text-[10px] text-muted mt-1">
          Predicted from existing AI scores on open cases. Not verified money. Not an ML forecast.
        </p>
        <div className="grid sm:grid-cols-4 gap-3 mt-3">
          <div>
            <div className="text-[10px] uppercase tracking-wide text-muted">Revenue at risk</div>
            <div className="text-lg tabular">{inr(forecast.revenueAtRisk)}</div>
          </div>
          {forecast.predictedRecoverableInr !== null ? (
            <div>
              <div className="flex items-center gap-1.5">
                <div className="text-[10px] uppercase tracking-wide text-muted">Predicted recoverable</div>
                <span className="text-[10px] uppercase tracking-wide text-muted border border-line rounded px-1 py-0.5">
                  Predicted
                </span>
              </div>
              <div className="text-lg tabular">{inr(forecast.predictedRecoverableInr)}</div>
            </div>
          ) : null}
          <div>
            <div className="flex items-center gap-1.5">
              <div className="text-[10px] uppercase tracking-wide text-muted">Verified recovered</div>
              <span className="text-[10px] uppercase tracking-wide text-gold border border-gold/30 rounded px-1 py-0.5">
                Verified
              </span>
            </div>
            <div className="text-lg tabular text-gold">{inr(forecast.verifiedRecoveredInr)}</div>
          </div>
          {forecast.scoredOpenCount ? (
            <div>
              <div className="text-[10px] uppercase tracking-wide text-muted">High-confidence open</div>
              <div className="text-lg tabular">{forecast.highConfidenceOpenCount}</div>
            </div>
          ) : null}
        </div>
      </section>

      <div className="grid lg:grid-cols-2 gap-3">
        <section className="rounded-lg border border-line bg-panel p-4">
          <div className="text-[11px] uppercase tracking-wide text-muted mb-3">Verified recovery by action</div>
          <div className="space-y-2">
            {playRows.map((id) => {
              const row = analytics.byPlay[id];
              return (
                <div key={id} className="flex items-baseline justify-between text-sm gap-3">
                  <span className="text-muted">{PLAY_LABEL[id]}</span>
                  <span className="tabular text-gold">
                    {inr(row.recoveredInr)}
                    <span className="text-muted text-xs"> · {row.recoveredCount}/{row.count}</span>
                  </span>
                </div>
              );
            })}
          </div>
        </section>
        <section className="rounded-lg border border-line bg-panel p-4">
          <div className="text-[11px] uppercase tracking-wide text-muted mb-3">Verified recovery by leak type</div>
          <div className="space-y-2">
            {leakMix.map((row) => (
              <div key={row.id} className="flex items-baseline justify-between text-sm gap-3">
                <span className="text-muted">{LEAK_LABEL[row.id]}</span>
                <span className="tabular text-gold">
                  {inr(row.recovered)}
                  <span className="text-muted text-xs"> · {row.count} cases</span>
                </span>
              </div>
            ))}
          </div>
        </section>
      </div>

      <div className="grid lg:grid-cols-[minmax(0,1fr)_320px] gap-4 min-w-0">
        <section className="rounded-lg border border-line bg-panel overflow-hidden min-w-0">
          <div className="px-4 py-3 border-b border-line flex flex-wrap items-center gap-2">
            <div className="text-xs uppercase tracking-wide text-muted mr-2">Pipeline</div>
            {["Detect", "Diagnose", "Recommend", "Policy", "Act", "Verified"].map((step, i) => (
              <span
                key={step}
                className={`text-xs px-2 py-1 rounded ${running ? "text-gold border border-gold/30" : "text-muted border border-line"}`}
              >
                {i + 1} {step}
              </span>
            ))}
            <span className="ml-auto text-xs text-muted min-w-0 truncate max-w-full">{liveLine}</span>
          </div>

          <div className="px-4 py-3 border-b border-line grid sm:grid-cols-5 gap-3">
            {leakMix.map((row) => (
              <button
                key={row.id}
                onClick={() => setLeak(row.id === leak ? "all" : row.id)}
                className="text-left"
              >
                <div className="text-[11px] uppercase tracking-wide text-muted">{LEAK_LABEL[row.id]}</div>
                <div className="text-xs text-muted mt-1">At risk {inr(row.amount)}</div>
                <div className="text-sm tabular mt-0.5 text-gold">Verified {inr(row.recovered)}</div>
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
            {view.audit.length ? (
              <ol className="mt-3 space-y-3 max-h-[360px] overflow-y-auto">
                {view.audit.slice(0, 18).map((ev) => (
                  <li key={ev.id}>
                    <button
                      className="text-left w-full min-w-0"
                      onClick={() => ev.caseId !== "SYSTEM" && setSelectedId(ev.caseId)}
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] uppercase tracking-wide text-gold-dim">{auditLane(ev)}</span>
                        <span className="font-mono text-[10px] text-muted truncate">{ev.caseId}</span>
                      </div>
                      <div className="text-xs font-medium mt-0.5">{auditActionShort(ev)}</div>
                      <div className="text-xs text-muted mt-0.5 whitespace-pre-wrap">{ev.reason}</div>
                      {ev.moneyDeltaInr ? (
                        <div className="text-[10px] text-gold tabular mt-0.5">{inr(ev.moneyDeltaInr)} verified</div>
                      ) : null}
                    </button>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="mt-3 text-xs text-muted">
                No audit events yet. Run a recovery batch to record detect → recommend → policy → action.
              </p>
            )}
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
              <button
                onClick={ingestWebhook}
                disabled={Boolean(ingestBusy)}
                className="text-xs border border-line rounded px-2 py-1 hover:border-gold/50 disabled:opacity-40"
              >
                {ingestBusy?.startsWith("Ingesting") ? ingestBusy : "Ingest event"}
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
            {ingestBusy ? <p className="text-xs text-gold">{ingestBusy}</p> : null}
            {ingestMsg ? (
              <p className={`text-xs ${ingestMsg.toLowerCase().includes("fail") ? "text-danger" : "text-ok"}`}>
                {ingestMsg}
              </p>
            ) : null}
          </section>

          <section className="rounded-lg border border-line bg-panel p-4 space-y-3">
            <div className="text-[11px] uppercase tracking-wide text-muted">Razorpay</div>
            {view.razorpay?.configured ? (
              <>
                <p className="text-xs text-gold">
                  Connected · {view.razorpay.mode} mode
                  {view.razorpay.webhookConfigured ? " · webhook verified" : " · add webhook secret for capture"}
                </p>
                <p className="text-xs text-muted">
                  Sync pulls failed payments. Recovery plays issue a live payment link. Captured webhooks mark the case recovered.
                </p>
                <button
                  onClick={async () => {
                    setIngestMsg(null);
                    setIngestBusy("Syncing failed Razorpay payments…");
                    try {
                      const res = await fetch("/api/razorpay/sync", { method: "POST" });
                      const data = (await res.json()) as WorkspaceView & { error?: string; imported?: number };
                      if (!res.ok) {
                        setIngestMsg(data.error ?? "Razorpay sync failed");
                        return;
                      }
                      setView(data);
                      setIngestMsg(`Imported ${data.imported ?? 0} failed payments`);
                    } catch (err) {
                      setIngestMsg(err instanceof Error ? err.message : "Razorpay sync failed");
                    } finally {
                      setIngestBusy(null);
                    }
                  }}
                  disabled={Boolean(ingestBusy)}
                  className="text-xs border border-gold/40 text-gold rounded px-2 py-1 hover:bg-gold/10 disabled:opacity-40"
                >
                  {ingestBusy?.startsWith("Syncing") ? ingestBusy : "Sync failed payments"}
                </button>
              </>
            ) : (
              <p className="text-xs text-muted">
                Sandbox is on. Set <span className="font-mono text-gold-dim">RAZORPAY_KEY_ID</span> and{" "}
                <span className="font-mono text-gold-dim">RAZORPAY_KEY_SECRET</span> in{" "}
                <span className="font-mono">.env.local</span> to issue real INR payment links. Webhook:{" "}
                <span className="font-mono text-gold-dim">/api/webhooks/razorpay</span>
              </p>
            )}
          </section>
        </aside>
      </div>

      <CaseDrawer
        cse={selected}
        llmConfigured={view.llmConfigured}
        busy={running || actionBusy}
        policy={view.policy}
        onClose={() => setSelectedId(null)}
        onAction={onAction}
      />
    </div>
  );
}

function Kpi({
  label,
  value,
  gold,
  hero,
  hint,
  badge,
}: {
  label: string;
  value: string;
  gold?: boolean;
  hero?: boolean;
  hint?: string;
  badge?: string;
}) {
  return (
    <div
      className={`rounded-lg border bg-panel px-4 py-3 min-w-0 ${
        hero ? "border-gold/40 glow" : "border-line"
      }`}
    >
      <div className="flex items-center gap-1.5 flex-wrap">
        <div className="text-[11px] uppercase tracking-wide text-muted">{label}</div>
        {badge ? (
          <span
            className={`text-[10px] uppercase tracking-wide rounded px-1.5 py-0.5 border ${
              hero ? "border-gold/40 text-gold" : "border-line text-muted"
            }`}
          >
            {badge}
          </span>
        ) : null}
      </div>
      <div className={`mt-1 tabular ${hero ? "text-3xl font-semibold text-gold" : gold ? "text-xl text-gold" : "text-xl"}`}>
        {value}
      </div>
      {hint ? <div className="text-[10px] text-muted mt-1 leading-snug">{hint}</div> : null}
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
