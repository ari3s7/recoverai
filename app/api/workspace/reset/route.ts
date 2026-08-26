import { resetWorkspace } from "@/lib/db/store";
import { json, workspaceView } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function POST() {
  const ws = await resetWorkspace();
  return json(workspaceView(ws));
}
