import { fail, json, workspaceView } from "@/lib/api";
import { appendAudit, mutateWorkspace } from "@/lib/db/store";
import { parseCasesCsv } from "@/lib/ingest/csv";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";
  let text = "";
  if (contentType.includes("text/csv") || contentType.includes("text/plain")) {
    text = await request.text();
  } else {
    const form = await request.formData().catch(() => null);
    const file = form?.get("file");
    if (file instanceof File) text = await file.text();
    else {
      const body = (await request.json().catch(() => null)) as { csv?: string } | null;
      text = body?.csv ?? "";
    }
  }
  if (!text.trim()) return fail("CSV body is empty");

  try {
    const ws = await mutateWorkspace((current) => {
      const { cases, errors } = parseCasesCsv(
        text,
        current.cases.map((c) => c.id),
      );
      if (!cases.length) {
        throw new Error(errors[0] ?? "No valid rows");
      }
      const events = cases.flatMap((c) => c.timeline);
      return appendAudit(
        { ...current, cases: [...cases, ...current.cases] },
        events,
      );
    });
    return json(workspaceView(ws));
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Import failed");
  }
}
