import { fail, json, workspaceView } from "@/lib/api";
import { appendAudit, mutateWorkspace } from "@/lib/db/store";
import { stamp } from "@/lib/engine/process";
import { inr } from "@/lib/format";
import type { RazorpayPayment } from "@/lib/razorpay/client";
import { razorpayStatus, verifyWebhookSignature } from "@/lib/razorpay/client";
import { caseFromRazorpayPayment, caseIdFromNotes } from "@/lib/razorpay/map";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Payload = {
  event?: string;
  payload?: {
    payment?: { entity?: RazorpayPayment };
    payment_link?: {
      entity?: {
        id?: string;
        short_url?: string;
        notes?: Record<string, string> | string[];
      };
    };
  };
};

export async function POST(request: Request) {
  const raw = await request.text();
  const signature = request.headers.get("x-razorpay-signature");
  const status = razorpayStatus();
  if (status.webhookConfigured && !verifyWebhookSignature(raw, signature)) {
    return fail("Invalid Razorpay signature", 401);
  }
  if (!status.webhookConfigured) {
    return fail("RAZORPAY_WEBHOOK_SECRET is not set", 401);
  }

  let body: Payload;
  try {
    body = JSON.parse(raw) as Payload;
  } catch {
    return fail("Invalid JSON");
  }

  const event = body.event ?? "";
  const payment = body.payload?.payment?.entity;
  const link = body.payload?.payment_link?.entity;

  try {
    const ws = await mutateWorkspace((current) => {
      if (event === "payment.failed" && payment) {
        const exists = current.cases.some((c) => c.signals.razorpayPaymentId === payment.id);
        if (exists) return current;
        const created = caseFromRazorpayPayment(
          payment,
          current.cases.map((c) => c.id),
        );
        return appendAudit({ ...current, cases: [created, ...current.cases] }, created.timeline);
      }

      if (event === "payment.captured" || event === "payment_link.paid") {
        const noteId = caseIdFromNotes(payment?.notes) ?? caseIdFromNotes(link?.notes);
        const found = current.cases.find(
          (c) =>
            c.id === noteId ||
            (link?.id && c.signals.razorpayPaymentLinkId === link.id) ||
            (payment?.id && c.signals.razorpayPaymentId === payment.id),
        );
        if (!found || found.status === "recovered") return current;
        const amount = payment ? Math.round(payment.amount / 100) : found.amountInr;
        const ev = stamp(
          found.id,
          "ingest",
          "razorpay.captured",
          `Razorpay captured ${payment?.id ?? link?.id ?? ""} · ${inr(amount)}`,
          amount,
        );
        const updated = {
          ...found,
          status: "recovered" as const,
          outcome: {
            status: "recovered" as const,
            recoveredInr: amount,
            promisedInr: 0,
            note: ev.reason,
          },
          execution: {
            ok: true,
            settled: true,
            provider: "razorpay" as const,
            referenceId: payment?.id ?? link?.id ?? ev.id,
            message: ev.reason,
            paymentLinkUrl: found.paymentLinkUrl ?? link?.short_url,
          },
          timeline: [...found.timeline, ev],
          updatedAt: new Date().toISOString(),
        };
        return appendAudit(
          { ...current, cases: current.cases.map((c) => (c.id === found.id ? updated : c)) },
          [ev],
        );
      }

      return current;
    });
    return json({ ok: true, event, ...workspaceView(ws) });
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Webhook failed", 500);
  }
}
