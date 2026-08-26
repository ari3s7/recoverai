import { json, workspaceView } from "@/lib/api";
import { getWorkspace, savePolicy } from "@/lib/db/store";
import { DEFAULT_POLICY } from "@/lib/policy/defaults";
import type { PolicyConfig } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  const ws = await getWorkspace();
  return json({ policy: ws.policy });
}

export async function PUT(request: Request) {
  let body: Partial<PolicyConfig>;
  try {
    body = (await request.json()) as Partial<PolicyConfig>;
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const current = (await getWorkspace()).policy;
  const next: PolicyConfig = {
    ...DEFAULT_POLICY,
    ...current,
    ...body,
    timezone: "Asia/Kolkata",
    maxContactsPer7Days: clampInt(body.maxContactsPer7Days ?? current.maxContactsPer7Days, 1, 10),
    quietHoursStart: clampInt(body.quietHoursStart ?? current.quietHoursStart, 0, 23),
    quietHoursEnd: clampInt(body.quietHoursEnd ?? current.quietHoursEnd, 0, 23),
    highAovInr: clampInt(body.highAovInr ?? current.highAovInr, 1000, 10_000_000),
    b2bEscalateDpd: clampInt(body.b2bEscalateDpd ?? current.b2bEscalateDpd, 1, 365),
    autoExecute: Boolean(body.autoExecute ?? current.autoExecute),
    sandboxClock: Boolean(body.sandboxClock ?? current.sandboxClock),
    sandboxClockIso: String(body.sandboxClockIso ?? current.sandboxClockIso),
  };

  const ws = await savePolicy(next);
  return json(workspaceView(ws));
}

function clampInt(n: number, min: number, max: number): number {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v)) return min;
  return Math.min(max, Math.max(min, v));
}
