import { fail, json, workspaceView } from "@/lib/api";
import { appendAudit, mutateWorkspace } from "@/lib/db/store";
import { listFailedPayments, razorpayConfigured } from "@/lib/razorpay/client";
import { caseFromRazorpayPayment } from "@/lib/razorpay/map";
import type { RunCase } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function POST() {
  if (!razorpayConfigured()) {
    return fail("Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET to sync.", 400);
  }
  try {
    const failed = await listFailedPayments(80);
    const ws = await mutateWorkspace((current) => {
      const existingIds = current.cases.map((c) => c.id);
      const known = new Set(
        current.cases.map((c) => c.signals.razorpayPaymentId).filter(Boolean) as string[],
      );
      const created: RunCase[] = [];
      for (const payment of failed) {
        if (known.has(payment.id)) continue;
        try {
          const cse = caseFromRazorpayPayment(payment, [...existingIds, ...created.map((c) => c.id)]);
          created.push(cse);
          known.add(payment.id);
        } catch {
          continue;
        }
      }
      if (!created.length) return current;
      return appendAudit(
        { ...current, cases: [...created, ...current.cases] },
        created.flatMap((c) => c.timeline),
      );
    });
    return json({ imported: failed.length, ...workspaceView(ws) });
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Razorpay sync failed", 502);
  }
}
