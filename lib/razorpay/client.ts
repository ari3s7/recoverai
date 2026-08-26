import { createHmac, timingSafeEqual } from "crypto";
import type { RazorpayStatus } from "../types";

const BASE = "https://api.razorpay.com/v1";

export type RazorpayPayment = {
  id: string;
  amount: number;
  currency: string;
  status: string;
  method?: string;
  email?: string;
  contact?: string;
  error_code?: string | null;
  error_description?: string | null;
  error_reason?: string | null;
  created_at: number;
  notes?: Record<string, string> | string[];
  order_id?: string | null;
};

export type RazorpayPaymentLink = {
  id: string;
  short_url: string;
  status: string;
  amount: number;
};

function keyId(): string | undefined {
  return process.env.RAZORPAY_KEY_ID?.trim() || undefined;
}

function keySecret(): string | undefined {
  return process.env.RAZORPAY_KEY_SECRET?.trim() || undefined;
}

function webhookSecret(): string | undefined {
  return process.env.RAZORPAY_WEBHOOK_SECRET?.trim() || undefined;
}

export function razorpayStatus(): RazorpayStatus {
  const id = keyId();
  const secret = keySecret();
  if (!id || !secret) {
    return { configured: false, mode: "off", webhookConfigured: Boolean(webhookSecret()) };
  }
  const mode = id.startsWith("rzp_live_") ? "live" : "test";
  return { configured: true, mode, webhookConfigured: Boolean(webhookSecret()) };
}

export function razorpayConfigured(): boolean {
  return razorpayStatus().configured;
}

function authHeader(): string {
  const id = keyId();
  const secret = keySecret();
  if (!id || !secret) throw new Error("Razorpay is not configured");
  return `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`;
}

async function razorpayFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      Authorization: authHeader(),
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    signal: AbortSignal.timeout(8000),
  });
  const body = (await res.json().catch(() => ({}))) as T & { error?: { description?: string } };
  if (!res.ok) {
    throw new Error(body.error?.description ?? `Razorpay ${res.status}`);
  }
  return body;
}

export async function listFailedPayments(count = 50): Promise<RazorpayPayment[]> {
  const data = await razorpayFetch<{ items?: RazorpayPayment[] }>(`/payments?count=${count}`);
  return (data.items ?? []).filter((p) => p.status === "failed");
}

export async function createPaymentLink(input: {
  caseId: string;
  amountInr: number;
  name: string;
  email?: string;
  contact?: string;
  description: string;
}): Promise<RazorpayPaymentLink> {
  const amountPaise = Math.round(input.amountInr * 100);
  if (amountPaise < 100) throw new Error("Amount must be at least ₹1");
  const expireBy = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 3;
  const customer: Record<string, string> = { name: input.name };
  if (input.email && input.email.includes("@")) customer.email = input.email;
  const contact = input.contact?.replace(/[^\d+]/g, "");
  if (contact && contact.replace(/\D/g, "").length >= 10) customer.contact = contact;

  return razorpayFetch<RazorpayPaymentLink>("/payment_links", {
    method: "POST",
    body: JSON.stringify({
      amount: amountPaise,
      currency: "INR",
      accept_partial: false,
      expire_by: expireBy,
      reference_id: input.caseId.slice(0, 40),
      description: input.description.slice(0, 2048),
      customer,
      notify: {
        sms: Boolean(customer.contact),
        email: Boolean(customer.email),
      },
      reminder_enable: true,
      notes: { recoverai_case_id: input.caseId },
    }),
  });
}

export function verifyWebhookSignature(rawBody: string, signature: string | null): boolean {
  const secret = webhookSecret();
  if (!secret || !signature) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
