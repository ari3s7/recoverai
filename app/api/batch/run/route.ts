import { computeTotals } from "@/lib/engine/totals";
import { isBatchEligible } from "@/lib/engine/runBatch";
import { processCase } from "@/lib/engine/process";
import { policyNow } from "@/lib/policy/defaults";
import { appendAudit, getWorkspace, mutateWorkspace } from "@/lib/db/store";
import { uid } from "@/lib/ids";
import type { BatchStreamEvent, RunCase } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function encode(event: BatchStreamEvent): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`);
}

export async function POST() {
  const batchId = uid("run");
  const startedAt = new Date().toISOString();
  const initial = await getWorkspace();
  const eligible = initial.cases.filter((c) => isBatchEligible(c, initial.policy));

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: BatchStreamEvent) => controller.enqueue(encode(event));
      try {
        send({
          type: "start",
          id: batchId,
          exposureInr: computeTotals(initial.cases).exposureInr,
          caseCount: eligible.length,
        });

        await mutateWorkspace((ws) => ({
          ...ws,
          runs: [
            {
              id: batchId,
              startedAt,
              caseCount: eligible.length,
              totals: computeTotals(ws.cases),
            },
            ...ws.runs,
          ].slice(0, 40),
        }));

        let latest: RunCase | undefined;
        for (const target of eligible) {
          try {
            const ws = await mutateWorkspace(async (current) => {
              const found = current.cases.find((c) => c.id === target.id);
              if (!found || !isBatchEligible(found, current.policy)) return current;
              const updated = {
                ...(await processCase({ ...found, status: "in_flight" }, current.policy, policyNow(current.policy))),
                lastBatchId: batchId,
              };
              const fresh = updated.timeline.slice(found.timeline.length);
              return appendAudit(
                {
                  ...current,
                  cases: current.cases.map((c) => (c.id === target.id ? updated : c)),
                },
                fresh,
              );
            });
            latest = ws.cases.find((c) => c.id === target.id);
            if (latest) {
              send({ type: "case", case: latest, totals: computeTotals(ws.cases) });
            }
          } catch (err) {
            const message = err instanceof Error ? err.message : "case failed";
            controller.enqueue(
              new TextEncoder().encode(
                `data: ${JSON.stringify({ type: "error", message, caseId: target.id })}\n\n`,
              ),
            );
          }
          await sleep(70);
        }

        const finishedAt = new Date().toISOString();
        const done = await mutateWorkspace((ws) => ({
          ...ws,
          runs: ws.runs.map((run) =>
            run.id === batchId
              ? { ...run, finishedAt, totals: computeTotals(ws.cases), caseCount: eligible.length }
              : run,
          ),
        }));

        send({
          type: "done",
          totals: computeTotals(done.cases),
          finishedAt,
          runId: batchId,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "batch failed";
        controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ type: "error", message })}\n\n`));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
