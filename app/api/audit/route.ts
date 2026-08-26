import { json } from "@/lib/api";
import { getWorkspace } from "@/lib/db/store";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const actor = searchParams.get("actor");
  const action = searchParams.get("action");
  const caseId = searchParams.get("caseId");
  const ws = await getWorkspace();
  let events = ws.audit;
  if (actor) events = events.filter((e) => e.actor === actor);
  if (action) events = events.filter((e) => e.action.includes(action));
  if (caseId) events = events.filter((e) => e.caseId === caseId);
  return json({ events, total: events.length });
}
