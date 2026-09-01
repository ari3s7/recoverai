"use client";

import { useEffect, useState } from "react";
import { CaseDrawer } from "@/components/case-drawer";
import { CaseTable } from "@/components/case-table";
import { loadWorkspace, type WorkspaceView } from "@/components/workspace";
import { inr, istDate } from "@/lib/format";
import { describePromiseLifecycle } from "@/lib/engine/promise";
import { policyNow } from "@/lib/policy/defaults";
import type { CaseActionRequest } from "@/lib/types";

export default function PromisesPage() {
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

  if (!view) return <div className="p-8 text-sm text-muted">{error ?? "Loading promises…"}</div>;

  const now = policyNow(view.policy);
  const withLife = view.cases
    .map((c) => ({ cse: c, life: describePromiseLifecycle(c, now) }))
    .filter((row) => row.life.state !== "none");
  const rows = withLife.filter((row) => row.life.state === "promised" || row.life.state === "due").map((r) => r.cse);
  const amount = rows.reduce((s, c) => s + (c.outcome?.promisedInr ?? c.amountInr), 0);
  const selected = view.cases.find((c) => c.id === selectedId) ?? null;
  const fulfilled = withLife.filter((r) => r.life.state === "fulfilled").length;
  const broken = withLife.filter((r) => r.life.state === "broken").length;

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
        <h1 className="text-2xl font-semibold tracking-tight">Promise-to-pay</h1>
        <p className="text-sm text-muted mt-1">
          PROMISED → payment due → fulfilled or broken. Active promises HOLD retries until the date. A broken
          promise re-enters AI → policy → action. Duplicate promises for the same date are ignored.
        </p>
      </div>
      <p className="text-sm">
        {rows.length} open · {inr(amount)} parked · {fulfilled} fulfilled · {broken} broken
      </p>
      <div className="rounded-lg border border-line bg-panel overflow-hidden">
        <CaseTable cases={rows} selectedId={selectedId} onOpen={setSelectedId} />
      </div>
      {rows.length ? (
        <ul className="text-xs text-muted space-y-1">
          {rows.map((c) => (
            <li key={c.id}>
              {c.id} · {describePromiseLifecycle(c, now).state} · due{" "}
              {c.outcome?.promisedDate ? istDate(`${c.outcome.promisedDate}T00:00:00+05:30`) : "—"}
            </li>
          ))}
        </ul>
      ) : null}
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
