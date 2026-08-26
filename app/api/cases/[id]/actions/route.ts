import { fail, json, workspaceView } from "@/lib/api";
import { appendAudit, mutateWorkspace } from "@/lib/db/store";
import { applyOperatorAction } from "@/lib/engine/actions";
import type { CaseActionRequest } from "@/lib/types";

export const dynamic = "force-dynamic";

function isAction(body: unknown): body is CaseActionRequest {
  if (!body || typeof body !== "object") return false;
  const type = (body as { type?: unknown }).type;
  return (
    type === "run" ||
    type === "stop" ||
    type === "escalate" ||
    type === "mark_recovered" ||
    type === "capture_promise" ||
    type === "release_hold"
  );
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail("Invalid JSON");
  }
  if (!isAction(body)) return fail("Unknown action");

  try {
    const ws = await mutateWorkspace(async (current) => {
      const found = current.cases.find((c) => c.id === id);
      if (!found) throw new Error("Case not found");
      const beforeLen = found.timeline.length;
      const updated = await applyOperatorAction(found, body, current.policy);
      const fresh = updated.timeline.slice(beforeLen);
      return appendAudit(
        {
          ...current,
          cases: current.cases.map((c) => (c.id === id ? updated : c)),
        },
        fresh,
      );
    });
    const updated = ws.cases.find((c) => c.id === id);
    return json({ case: updated, ...workspaceView(ws) });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Action failed";
    return fail(message, message === "Case not found" ? 404 : 400);
  }
}
