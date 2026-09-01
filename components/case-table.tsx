"use client";

import { inr, ist, LEAK_LABEL, PLAY_LABEL } from "@/lib/format";
import type { RunCase } from "@/lib/types";
import { StatusPill } from "./status-pill";

export function CaseTable({
  cases,
  selectedId,
  onOpen,
}: {
  cases: RunCase[];
  selectedId?: string | null;
  onOpen: (id: string) => void;
}) {
  if (!cases.length) {
    return (
      <div className="px-4 py-12 text-center text-sm text-muted">
        No cases in this view.
        <span className="block text-xs mt-1">Adjust filters, ingest an event, or reset the workspace to the seeded desk.</span>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm min-w-[720px]">
        <thead className="text-[11px] uppercase tracking-wide text-muted border-b border-line">
          <tr>
            <th className="px-3 py-2 font-medium">ID</th>
            <th className="px-3 py-2 font-medium">Customer</th>
            <th className="px-3 py-2 font-medium">Leak</th>
            <th className="px-3 py-2 font-medium text-right">At risk</th>
            <th className="px-3 py-2 font-medium">Cause</th>
            <th className="px-3 py-2 font-medium">Recommended play</th>
            <th className="px-3 py-2 font-medium">Status</th>
            <th className="px-3 py-2 font-medium">Updated</th>
          </tr>
        </thead>
        <tbody>
          {cases.map((c) => (
            <tr
              key={c.id}
              onClick={() => onOpen(c.id)}
              className={`cursor-pointer border-b border-line/70 hover:bg-white/[0.03] ${
                selectedId === c.id ? "bg-gold/10" : ""
              } ${c.status === "in_flight" ? "bg-gold/5" : ""}`}
            >
              <td className="px-3 py-2 font-mono text-xs text-gold-dim whitespace-nowrap">{c.id}</td>
              <td className="px-3 py-2 max-w-[180px]">
                <div className="text-foreground truncate">{c.customer.company ?? c.customer.name}</div>
                <div className="text-[11px] text-muted truncate">
                  {c.customer.company ? c.customer.name + " · " : ""}
                  {c.customer.city}
                </div>
              </td>
              <td className="px-3 py-2 text-muted whitespace-nowrap">{LEAK_LABEL[c.leakType]}</td>
              <td className="px-3 py-2 text-right tabular whitespace-nowrap">{inr(c.amountInr)}</td>
              <td className="px-3 py-2 text-muted max-w-[140px] truncate">{c.diagnosis?.label ?? "—"}</td>
              <td className="px-3 py-2 text-muted whitespace-nowrap">
                {c.agent ? PLAY_LABEL[c.agent.recommendedPlay] : (c.play?.label ?? "—")}
              </td>
              <td className="px-3 py-2 whitespace-nowrap">
                <StatusPill status={c.status} />
              </td>
              <td className="px-3 py-2 font-mono text-[11px] text-muted whitespace-nowrap">{ist(c.updatedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
