import { nextCaseId, uid } from "../ids";
import type { LeakType, RunCase } from "../types";
import type { RazorpayPayment } from "./client";

function notesMap(notes?: Record<string, string> | string[]): Record<string, string> {
  if (!notes || Array.isArray(notes)) return {};
  return notes;
}

function maskContact(contact?: string): string {
  const digits = (contact ?? "").replace(/\D/g, "");
  if (digits.length < 4) return "+91 98•• ••000";
  return `+91 •• ••${digits.slice(-4)}`;
}

function declineCode(p: RazorpayPayment): string {
  const blob = `${p.error_code ?? ""} ${p.error_reason ?? ""} ${p.error_description ?? ""}`.toLowerCase();
  if (blob.includes("insufficient")) return "INSUFFICIENT_FUNDS";
  if (blob.includes("expired")) return "EXPIRED_CARD";
  if (blob.includes("mandate") || blob.includes("token")) return "MANDATE_REVOKED";
  return (p.error_code || p.error_reason || "DO_NOT_HONOR").toUpperCase();
}

function leakType(p: RazorpayPayment): LeakType {
  const blob = `${p.method ?? ""} ${p.error_reason ?? ""}`.toLowerCase();
  if (blob.includes("emandate") || blob.includes("subscription")) return "failed_subscription";
  if (blob.includes("mandate") || blob.includes("token")) return "mandate_failure";
  return "payment_failure";
}

export function caseIdFromNotes(notes?: Record<string, string> | string[]): string | undefined {
  return notesMap(notes).recoverai_case_id;
}

export function caseFromRazorpayPayment(p: RazorpayPayment, existingIds: string[]): RunCase {
  const now = new Date().toISOString();
  const occurredAt = new Date((p.created_at || Date.now() / 1000) * 1000).toISOString();
  const amountInr = Math.round((p.amount ?? 0) / 100);
  if (amountInr <= 0) throw new Error("Razorpay payment has no amount");
  const name = p.email?.split("@")[0] ?? p.contact ?? "Razorpay customer";
  const leak = leakType(p);
  const id = nextCaseId(existingIds);
  return {
    id,
    customer: {
      name,
      city: "India",
      language: "hinglish",
      phoneMasked: maskContact(p.contact),
      channelPref: "whatsapp",
      email: p.email || undefined,
      contact: p.contact || undefined,
    },
    leakType: leak,
    amountInr,
    occurredAt,
    merchantSegment: leak === "overdue_invoice" ? "b2b" : "d2c",
    signals: {
      declineCode: declineCode(p),
      retryCount: 0,
      contactsLast7Days: 0,
      razorpayPaymentId: p.id,
      paymentSuccessRate: 0.6,
      lifetimePayments: 4,
      successfulPayments: 3,
      failedPayments: 1,
      flags: [],
    },
    status: "at_risk",
    timeline: [
      {
        id: uid("evt"),
        ts: now,
        caseId: id,
        actor: "ingest",
        action: "razorpay.sync",
        reason: `Razorpay ${p.status} ${p.id} · ${p.error_description ?? p.error_code ?? "failed"}`,
      },
    ],
    updatedAt: now,
  };
}
