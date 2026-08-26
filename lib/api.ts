import { NextResponse } from "next/server";
import { computeTotals } from "@/lib/engine/totals";
import { llmConfigured } from "@/lib/llm";
import type { Workspace } from "@/lib/types";

export const dynamic = "force-dynamic";

export function json(data: unknown, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export function fail(message: string, status = 400) {
  return json({ error: message }, status);
}

export function workspaceView(ws: Workspace) {
  return {
    merchant: ws.merchant,
    policy: ws.policy,
    cases: ws.cases,
    totals: computeTotals(ws.cases),
    audit: ws.audit.slice(0, 250),
    runs: ws.runs.slice(0, 12),
    llmConfigured: llmConfigured(),
  };
}
