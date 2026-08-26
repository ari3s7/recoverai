"use client";

import { useEffect, useState } from "react";
import { CaseDrawer } from "@/components/case-drawer";
import { CaseTable } from "@/components/case-table";
import { loadWorkspace, type WorkspaceView } from "@/components/workspace";
import { inr, istDate } from "@/lib/format";
import type { CaseActionRequest } from "@/lib/types";

export default function PromisesPage() {
  const [view, setView] = useState<WorkspaceView | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadWorkspace().then((next) => {
      if (!cancelled) setView(next);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!view) return <div className="p-8 text-sm text-muted">Loading promises…</div>;

  const rows = view.cases.filter((c) => c.status === "promised");
  const amount = rows.reduce((s, c) => s + (c.outcome?.promisedInr ?? c.amountInr), 0);
  const selected = view.cases.find((c) => c.id === selectedId) ?? null;

  async function onAction(id: string, action: CaseActionRequest) {
    const res = await fetch(`/api/cases/${id}/actions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(action),
    });
    setView((await res.json()) as WorkspaceView);
  }

  return (
    <div className="p-5 space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Promise-to-pay</h1>
        <p className="text-sm text-muted mt-1">
          Dated commitments. Active promises HOLD retries until the date. A breached date releases the hold and
          recovery follows remaining policy. Mark recovered when cash lands.
        </p>
      </div>
      <p className="text-sm">
        {rows.length} open promises · {inr(amount)} parked
      </p>
      <div className="rounded-lg border border-line bg-panel overflow-hidden">
        <CaseTable cases={rows} selectedId={selectedId} onOpen={setSelectedId} />
      </div>
      {rows.length ? (
        <ul className="text-xs text-muted space-y-1">
          {rows.map((c) => (
            <li key={c.id}>
              {c.id} · due {c.outcome?.promisedDate ? istDate(`${c.outcome.promisedDate}T00:00:00+05:30`) : "—"}
            </li>
          ))}
        </ul>
      ) : null}
      <CaseDrawer
        cse={selected}
        llmConfigured={view.llmConfigured}
        onClose={() => setSelectedId(null)}
        onAction={onAction}
      />
    </div>
  );
}
