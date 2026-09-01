"use client";

import { useEffect, useMemo, useState } from "react";
import { loadWorkspace, type WorkspaceView } from "@/components/workspace";
import { auditActionShort, auditLane } from "@/components/ui-copy";
import { inr, ist } from "@/lib/format";

export default function AuditPage() {
  const [view, setView] = useState<WorkspaceView | null>(null);
  const [actor, setActor] = useState("all");
  const [q, setQ] = useState("");

  useEffect(() => {
    let cancelled = false;
    loadWorkspace().then((next) => {
      if (!cancelled) setView(next);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const events = useMemo(() => {
    if (!view) return [];
    return view.audit.filter((e) => {
      if (actor !== "all" && e.actor !== actor) return false;
      if (q) {
        const hay = `${e.caseId} ${e.action} ${e.reason}`.toLowerCase();
        if (!hay.includes(q.toLowerCase())) return false;
      }
      return true;
    });
  }, [view, actor, q]);

  function exportJson() {
    const blob = new Blob([JSON.stringify(events, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "recoverai-audit.json";
    a.click();
    URL.revokeObjectURL(url);
  }

  function exportCsv() {
    const header = "ts,caseId,actor,action,reason,moneyDeltaInr";
    const lines = events.map((e) =>
      [e.ts, e.caseId, e.actor, e.action, JSON.stringify(e.reason), e.moneyDeltaInr ?? ""].join(","),
    );
    const blob = new Blob([[header, ...lines].join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "recoverai-audit.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  if (!view) return <div className="p-8 text-sm text-muted">Loading audit…</div>;

  const recovered = events.filter((e) => e.moneyDeltaInr).reduce((s, e) => s + (e.moneyDeltaInr ?? 0), 0);

  return (
    <div className="p-5 space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Audit trail</h1>
          <p className="text-sm text-muted mt-1">
            AI_DECISION, POLICY_DECISION, ACTION_EXECUTED / BLOCKED / HELD / ESCALATED, PAYMENT_OUTCOME,
            RECOVERY_RESULT. Export for judges.
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={exportJson} className="text-sm border border-line rounded px-3 py-1.5">
            Export JSON
          </button>
          <button onClick={exportCsv} className="text-sm border border-line rounded px-3 py-1.5">
            Export CSV
          </button>
        </div>
      </div>
      <p className="text-sm text-muted">
        {events.length} events · verified recovered deltas {inr(recovered)}
      </p>
      <div className="flex gap-2">
        <select
          value={actor}
          onChange={(e) => setActor(e.target.value)}
          className="bg-panel border border-line rounded px-2 py-1 text-sm"
        >
          <option value="all">All actors</option>
          <option value="ai">AI</option>
          <option value="agent">AGENT</option>
          <option value="policy">POLICY</option>
          <option value="human">HUMAN</option>
          <option value="ingest">INGEST / WEBHOOK</option>
        </select>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Filter case, action, reason"
          className="bg-panel border border-line rounded px-2 py-1 text-sm flex-1"
        />
      </div>
      <div className="rounded-lg border border-line bg-panel overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-[11px] uppercase tracking-wide text-muted border-b border-line">
            <tr>
              <th className="px-3 py-2 font-medium">Time</th>
              <th className="px-3 py-2 font-medium">Case</th>
              <th className="px-3 py-2 font-medium">Actor</th>
              <th className="px-3 py-2 font-medium">Action</th>
              <th className="px-3 py-2 font-medium">Reason</th>
              <th className="px-3 py-2 font-medium text-right">₹</th>
            </tr>
          </thead>
          <tbody>
            {events.length ? (
              events.map((e) => (
                <tr key={e.id} className="border-b border-line/70">
                  <td className="px-3 py-2 font-mono text-[11px] text-muted whitespace-nowrap">{ist(e.ts)}</td>
                  <td className="px-3 py-2 font-mono text-xs text-gold-dim whitespace-nowrap">{e.caseId}</td>
                  <td className="px-3 py-2 text-gold-dim whitespace-nowrap">{auditLane(e)}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{auditActionShort(e)}</td>
                  <td className="px-3 py-2 text-muted max-w-xl">{e.reason}</td>
                  <td className="px-3 py-2 text-right tabular text-gold whitespace-nowrap">
                    {e.moneyDeltaInr ? inr(e.moneyDeltaInr) : ""}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={6} className="px-3 py-10 text-center text-sm text-muted">
                  No audit events match this filter. Run a recovery batch or clear the search.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
