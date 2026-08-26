import { getWorkspace } from "@/lib/db/store";
import { runEvaluation } from "@/lib/evaluation/run";
import { json } from "@/lib/api";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    dataset?: "seed" | "synthetic";
    syntheticCount?: number;
  };
  const ws = await getWorkspace();
  const report = await runEvaluation({
    dataset: body.dataset ?? "synthetic",
    syntheticCount: Math.min(5000, Math.max(100, body.syntheticCount ?? 2000)),
    policy: ws.policy,
  });
  return json(report);
}

export async function GET() {
  const ws = await getWorkspace();
  const report = await runEvaluation({
    dataset: "seed",
    policy: ws.policy,
  });
  return json(report);
}
