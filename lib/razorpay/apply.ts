import { stamp } from "../engine/process";
import { inr } from "../format";
import type { RazorpayPayment } from "./client";
import { caseFromRazorpayPayment, caseIdFromNotes } from "./map";
import { appendAudit } from "../db/store";
import type { Workspace } from "../types";

export type RazorpayWebhookInput = {
  event: string;
  payment?: RazorpayPayment;
  link?: {
    id?: string;
    short_url?: string;
    notes?: Record<string, string> | string[];
  };
};

/**
 * Apply a verified Razorpay event to workspace state.
 * Payment-link creation is not handled here — only ingest + capture.
 * Duplicate captures are no-ops.
 */
export function applyRazorpayWebhook(current: Workspace, input: RazorpayWebhookInput): Workspace {
  const { event, payment, link } = input;

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
    if (!found) return current;
    if (found.status === "recovered" && (found.outcome?.recoveredInr ?? 0) > 0) {
      return current;
    }
    const amount = payment ? Math.round(payment.amount / 100) : found.amountInr;
    const ev = stamp(
      found.id,
      "ingest",
      "PAYMENT_OUTCOME",
      `Razorpay captured ${payment?.id ?? link?.id ?? ""} · ${inr(amount)}`,
      amount,
    );
    const recovery = stamp(
      found.id,
      "ingest",
      "RECOVERY_RESULT",
      `actualRecovered ${inr(amount)}`,
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
      executionStatus: "executed" as const,
      timeline: [...found.timeline, ev, recovery],
      updatedAt: new Date().toISOString(),
    };
    return appendAudit(
      { ...current, cases: current.cases.map((c) => (c.id === found.id ? updated : c)) },
      [ev, recovery],
    );
  }

  return current;
}
