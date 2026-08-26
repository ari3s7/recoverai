import { fail, json, workspaceView } from "@/lib/api";
import { appendAudit, mutateWorkspace } from "@/lib/db/store";
import { caseFromWebhook, type WebhookPayload } from "@/lib/ingest/csv";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let payload: WebhookPayload;
  try {
    payload = (await request.json()) as WebhookPayload;
  } catch {
    return fail("Invalid JSON");
  }

  try {
    const ws = await mutateWorkspace((current) => {
      const created = caseFromWebhook(
        payload,
        current.cases.map((c) => c.id),
      );
      return appendAudit(
        { ...current, cases: [created, ...current.cases] },
        created.timeline,
      );
    });
    return json({
      case: ws.cases[0],
      ...workspaceView(ws),
    });
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Ingest failed");
  }
}
