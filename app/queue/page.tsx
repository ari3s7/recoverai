"use client";

import { useCallback, useEffect, useState } from "react";
import { CaseDrawer } from "@/components/case-drawer";
import { CaseTable } from "@/components/case-table";
import { loadWorkspace, type WorkspaceView } from "@/components/workspace";
import { inr } from "@/lib/format";
import type { CaseActionRequest } from "@/lib/types";

export default function QueuePage() {
  const [view, setView] = useState<WorkspaceView | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setView(await loadWorkspace());
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  if (!view) return <div className="p-8 text-sm text-muted">Loading queue…</div>;

  const rows = view.cases.filter((c) => c.status === "escalated");
  const amount = rows.reduce((s, c) => s + c.amountInr, 0);
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
        <h1 className="text-2xl font-semibold tracking-tight">Human queue</h1>
        <p className="text-sm text-muted mt-1">
          High-AOV, 60+ DPD B2B, and auto-execute-off cases. No voice. Operators recover, promise, or stop.
        </p>
      </div>
      <p className="text-sm">
        {rows.length} cases · {inr(amount)} gated from automation
      </p>
      <div className="rounded-lg border border-line bg-panel overflow-hidden">
        <CaseTable cases={rows} selectedId={selectedId} onOpen={setSelectedId} />
      </div>
      <CaseDrawer
        cse={selected}
        llmConfigured={view.llmConfigured}
        onClose={() => setSelectedId(null)}
        onAction={onAction}
      />
    </div>
  );
}
