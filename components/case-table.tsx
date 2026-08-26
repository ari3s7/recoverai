"use client";

import { inr, ist, LEAK_LABEL } from "@/lib/format";
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
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="text-[11px] uppercase tracking-wide text-muted border-b border-line">
          <tr>
            <th className="px-3 py-2 font-medium">ID</th>
            <th className="px-3 py-2 font-medium">Customer</th>
            <th className="px-3 py-2 font-medium">Leak</th>
            <th className="px-3 py-2 font-medium text-right">Amount</th>
            <th className="px-3 py-2 font-medium">Cause</th>
            <th className="px-3 py-2 font-medium">Play</th>
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
              <td className="px-3 py-2 font-mono text-xs text-gold-dim">{c.id}</td>
              <td className="px-3 py-2">
                <div className="text-foreground">{c.customer.company ?? c.customer.name}</div>
                <div className="text-[11px] text-muted">
                  {c.customer.company ? c.customer.name + " · " : ""}
                  {c.customer.city}
                </div>
              </td>
              <td className="px-3 py-2 text-muted">{LEAK_LABEL[c.leakType]}</td>
              <td className="px-3 py-2 text-right tabular">{inr(c.amountInr)}</td>
              <td className="px-3 py-2 text-muted">{c.diagnosis?.label ?? "—"}</td>
              <td className="px-3 py-2 text-muted">{c.play?.label ?? "—"}</td>
              <td className="px-3 py-2">
                <StatusPill status={c.status} />
              </td>
              <td className="px-3 py-2 font-mono text-[11px] text-muted">{ist(c.updatedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
