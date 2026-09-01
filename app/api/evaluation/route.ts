import { getWorkspace } from "@/lib/db/store";
import { runEvaluation } from "@/lib/evaluation/run";
import { runWhatIf } from "@/lib/evaluation/whatIf";
import { fail, json } from "@/lib/api";
import { normalizePolicy } from "@/lib/policy/defaults";
import type { PolicyConfig } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    dataset?: "seed" | "synthetic";
    syntheticCount?: number;
    proposedPolicy?: Partial<PolicyConfig>;
  };
  try {
    const ws = await getWorkspace();
    if (body.proposedPolicy) {
      const report = await runWhatIf({
        currentPolicy: ws.policy,
        proposedPolicy: normalizePolicy({ ...ws.policy, ...body.proposedPolicy }),
        dataset: body.dataset ?? "seed",
        syntheticCount: body.syntheticCount
          ? Math.min(5000, Math.max(100, body.syntheticCount))
          : undefined,
      });
      return json(report);
    }
    const report = await runEvaluation({
      dataset: body.dataset ?? "synthetic",
      syntheticCount: Math.min(5000, Math.max(100, body.syntheticCount ?? 2000)),
      policy: ws.policy,
    });
    return json(report);
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Evaluation failed", 500);
  }
}

export async function GET() {
  try {
    const ws = await getWorkspace();
    const report = await runEvaluation({
      dataset: "seed",
      policy: ws.policy,
    });
    return json(report);
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Evaluation failed", 500);
  }
}
