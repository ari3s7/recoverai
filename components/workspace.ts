import { computeTotals } from "@/lib/engine/totals";
import type { AuditEvent, BatchTotals, PolicyConfig, RunCase, Workspace } from "@/lib/types";

export type WorkspaceView = {
  merchant: Workspace["merchant"];
  policy: PolicyConfig;
  cases: RunCase[];
  totals: BatchTotals;
  audit: AuditEvent[];
  runs: Workspace["runs"];
  llmConfigured: boolean;
};

export async function loadWorkspace(): Promise<WorkspaceView> {
  const res = await fetch("/api/workspace", { cache: "no-store" });
  if (!res.ok) throw new Error("Failed to load workspace");
  return res.json() as Promise<WorkspaceView>;
}

export function mergeCase(view: WorkspaceView, next: RunCase): WorkspaceView {
  const cases = view.cases.map((c) => (c.id === next.id ? next : c));
  return {
    ...view,
    cases,
    totals: computeTotals(cases),
    audit: [...next.timeline.slice(-4).reverse(), ...view.audit].slice(0, 250),
  };
}

export async function readSse(
  response: Response,
  onEvent: (event: Record<string, unknown>) => void,
): Promise<void> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("No stream");
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const parts = buf.split("\n\n");
    buf = parts.pop() ?? "";
    for (const part of parts) {
      const line = part.split("\n").find((l) => l.startsWith("data: "));
      if (!line) continue;
      onEvent(JSON.parse(line.slice(6)) as Record<string, unknown>);
    }
  }
}
