import { json, workspaceView } from "@/lib/api";
import { getWorkspace } from "@/lib/db/store";

export const dynamic = "force-dynamic";

export async function GET() {
  const ws = await getWorkspace();
  return json({
    cases: ws.cases,
    totals: workspaceView(ws).totals,
  });
}
