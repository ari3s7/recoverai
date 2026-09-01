"use client";

import { useEffect, useState } from "react";
import { CaseDrawer } from "@/components/case-drawer";
import { CaseTable } from "@/components/case-table";
import { loadWorkspace, type WorkspaceView } from "@/components/workspace";
import { inr } from "@/lib/format";
import type { CaseActionRequest } from "@/lib/types";

export default function QueuePage() {
  const [view, setView] = useState<WorkspaceView | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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

  if (!view) return <div className="p-8 text-sm text-muted">{error ?? "Loading queue…"}</div>;

  const rows = view.cases.filter((c) => c.status === "escalated");
  const amount = rows.reduce((s, c) => s + c.amountInr, 0);
  const selected = view.cases.find((c) => c.id === selectedId) ?? null;

  async function onAction(id: string, action: CaseActionRequest) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/cases/${id}/actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action),
      });
      const data = (await res.json()) as WorkspaceView & { error?: string };
      if (!res.ok) {
        const message = data.error ?? "Action failed";
        setError(message);
        throw new Error(message);
      }
      setView(data);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="p-5 space-y-4">
      {error ? (
        <div className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</div>
      ) : null}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Human queue</h1>
        <p className="text-sm text-muted mt-1">
          High-AOV, 60+ DPD B2B, and auto-execute-off cases. No voice. Operators recover, promise, or stop.
        </p>
      </div>
      <p className="text-sm">
        {rows.length} cases · {inr(amount)} gated from automation
      </p>
      <div className="rounded-lg border border-line bg-panel overflow-hidden">
        {rows.length ? (
          <CaseTable cases={rows} selectedId={selectedId} onOpen={setSelectedId} />
        ) : (
          <div className="px-4 py-12 text-center text-sm text-muted">
            No cases in the human queue.
            <span className="block text-xs mt-1">
              High-AOV, 60+ DPD B2B, and auto-execute-off cases land here after policy evaluation.
            </span>
          </div>
        )}
      </div>
      <CaseDrawer
        cse={selected}
        llmConfigured={view.llmConfigured}
        policy={view.policy}
        busy={busy}
        onClose={() => setSelectedId(null)}
        onAction={onAction}
      />
    </div>
  );
}
