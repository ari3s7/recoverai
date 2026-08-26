"use client";

import { useCallback, useEffect, useState } from "react";
import { loadWorkspace, type WorkspaceView } from "@/components/workspace";
import { inr } from "@/lib/format";
import type { PolicyConfig } from "@/lib/types";

export default function PolicyPage() {
  const [view, setView] = useState<WorkspaceView | null>(null);
  const [policy, setPolicy] = useState<PolicyConfig | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const next = await loadWorkspace();
    setView(next);
    setPolicy(next.policy);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function save() {
    if (!policy) return;
    const res = await fetch("/api/policy", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(policy),
    });
    const data = (await res.json()) as WorkspaceView;
    setView(data);
    setPolicy(data.policy);
    setSaved("Policy saved. Next batch uses these stopping rules.");
  }

  if (!view || !policy) return <div className="p-8 text-sm text-muted">Loading policy…</div>;

  return (
    <div className="p-5 max-w-3xl space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Stopping rules</h1>
        <p className="text-sm text-muted mt-1">
          Hard gates before any outbound. Sandbox clock keeps quiet-hours demos stable; turn it off to use live IST.
        </p>
      </div>

      <div className="rounded-lg border border-line bg-panel p-5 grid sm:grid-cols-2 gap-4">
        <NumberField
          label="Max contacts / 7 days"
          value={policy.maxContactsPer7Days}
          onChange={(n) => setPolicy({ ...policy, maxContactsPer7Days: n })}
        />
        <NumberField
          label="Human gate (INR)"
          value={policy.highAovInr}
          onChange={(n) => setPolicy({ ...policy, highAovInr: n })}
        />
        <NumberField
          label="Quiet hours start (24h)"
          value={policy.quietHoursStart}
          onChange={(n) => setPolicy({ ...policy, quietHoursStart: n })}
        />
        <NumberField
          label="Quiet hours end (24h)"
          value={policy.quietHoursEnd}
          onChange={(n) => setPolicy({ ...policy, quietHoursEnd: n })}
        />
        <NumberField
          label="B2B escalate DPD"
          value={policy.b2bEscalateDpd}
          onChange={(n) => setPolicy({ ...policy, b2bEscalateDpd: n })}
        />
        <label className="text-sm">
          Sandbox clock (ISO)
          <input
            value={policy.sandboxClockIso}
            onChange={(e) => setPolicy({ ...policy, sandboxClockIso: e.target.value })}
            className="mt-1 w-full bg-background border border-line rounded px-2 py-1.5 font-mono text-xs"
          />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={policy.sandboxClock}
            onChange={(e) => setPolicy({ ...policy, sandboxClock: e.target.checked })}
          />
          Use sandbox clock instead of live IST
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={policy.autoExecute}
            onChange={(e) => setPolicy({ ...policy, autoExecute: e.target.checked })}
          />
          Auto-execute plays (off = queue for humans)
        </label>
      </div>

      <button onClick={save} className="rounded-md bg-gold text-background px-4 py-2 text-sm font-medium">
        Save policy
      </button>
      {saved ? <p className="text-sm text-ok">{saved}</p> : null}

      <section className="text-sm text-muted space-y-2">
        <p>Also always stop: DNC, complaint, legal, fraud, chargeback.</p>
        <p>Hold: active promise-to-pay, quiet hours.</p>
        <p>Escalate: amount ≥ {inr(policy.highAovInr)} or B2B DPD ≥ {policy.b2bEscalateDpd}.</p>
      </section>
    </div>
  );
}

function NumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
}) {
  return (
    <label className="text-sm">
      {label}
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1 w-full bg-background border border-line rounded px-2 py-1.5"
      />
    </label>
  );
}
