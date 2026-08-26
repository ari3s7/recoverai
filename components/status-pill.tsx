import { STATUS_LABEL } from "@/lib/format";
import type { CaseStatus } from "@/lib/types";

const TONE: Record<CaseStatus, string> = {
  at_risk: "text-muted border-line",
  in_flight: "text-gold border-gold/40 bg-gold/10",
  recovered: "text-gold border-gold/50 bg-gold/10",
  promised: "text-ok border-ok/40 bg-ok/10",
  escalated: "text-cyan border-cyan/40 bg-cyan/10",
  stopped: "text-danger border-danger/40 bg-danger/10",
  held: "text-muted border-line bg-white/5",
};

export function StatusPill({ status }: { status: CaseStatus }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] uppercase tracking-wide ${TONE[status]}`}>
      {STATUS_LABEL[status]}
    </span>
  );
}
