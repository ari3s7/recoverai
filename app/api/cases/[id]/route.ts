import { fail, json } from "@/lib/api";
import { getWorkspace } from "@/lib/db/store";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const ws = await getWorkspace();
  const found = ws.cases.find((c) => c.id === id);
  if (!found) return fail("Case not found", 404);
  return json({ case: found });
}
