import { fail, json } from "@/lib/api";
import { getWorkspace } from "@/lib/db/store";
import { llmConfigured, polishCopy, polishInputFrom } from "@/lib/llm";

export const dynamic = "force-dynamic";

export async function GET() {
  return json({ configured: llmConfigured() });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { caseId?: string } | null;
  const caseId = body?.caseId;
  if (!caseId) return fail("caseId is required");
  const ws = await getWorkspace();
  const found = ws.cases.find((c) => c.id === caseId);
  if (!found) return fail("Case not found", 404);
  if (!found.diagnosis) return fail("Run the case before polishing copy", 409);

  const polished = await polishCopy(
    polishInputFrom(found.diagnosis, found.play, found.customer.name, found.customer.language),
  );
  return json({
    configured: llmConfigured(),
    provider: polished.provider,
    narrative: polished.narrative,
    script: polished.script,
  });
}
