import { json, workspaceView } from "@/lib/api";
import { getWorkspace } from "@/lib/db/store";

export const dynamic = "force-dynamic";

export async function GET() {
  const ws = await getWorkspace();
  const view = workspaceView(ws);
  return json({
    lastRun: ws.runs[0] ?? null,
    totals: view.totals,
    processed: view.totals.processedCount,
  });
}
