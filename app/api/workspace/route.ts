import { getWorkspace } from "@/lib/db/store";
import { json, workspaceView } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET() {
  const ws = await getWorkspace();
  return json(workspaceView(ws));
}
