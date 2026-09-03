import { createHmac, timingSafeEqual } from "crypto";
import { uid } from "../ids";
import type { RazorpayFailureReason, RazorpayStatus } from "../types";

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

export class RazorpayRequestError extends Error {
  readonly status?: number;
  readonly reason: RazorpayFailureReason;
  retryCount = 0;

  constructor(message: string, opts: { status?: number; reason: RazorpayFailureReason }) {
    super(message);
    this.name = "RazorpayRequestError";
    this.status = opts.status;
    this.reason = opts.reason;
  }
}

export function classifyRazorpayFailure(input: {
  status?: number;
  message?: string;
  cause?: unknown;
}): RazorpayFailureReason {
  const status = input.status;
  const message = `${input.message ?? ""} ${causeMessage(input.cause)}`.toLowerCase();

  if (status === 429 || message.includes("too many requests") || message.includes("rate limit")) {
    return "rate_limited";
  }
  if (isTimeoutCause(input.cause) || /\btimeout\b|timed out|aborted due to timeout/.test(message)) {
    return "timeout";
  }
  if (status !== undefined && status >= 500) return "transient_error";
  if (
    isNetworkCause(input.cause) ||
    message.includes("fetch failed") ||
    message.includes("network") ||
    message.includes("econnreset") ||
    message.includes("socket")
  ) {
    return "transient_error";
  }
  return "permanent_error";
}

export function isTransientRazorpayFailure(reason: RazorpayFailureReason): boolean {
  return reason === "rate_limited" || reason === "transient_error" || reason === "timeout";
}

function causeMessage(cause: unknown): string {
  if (cause instanceof Error) return cause.message;
  return "";
}

function isTimeoutCause(cause: unknown): boolean {
  if (!cause || typeof cause !== "object") return false;
  const name = "name" in cause ? String(cause.name) : "";
  return name === "TimeoutError" || name === "AbortError";
}

function isNetworkCause(cause: unknown): boolean {
  if (!cause || typeof cause !== "object") return false;
  const name = "name" in cause ? String(cause.name) : "";
  const code = "code" in cause ? String(cause.code).toLowerCase() : "";
  return name === "TypeError" || code === "econnreset" || code === "enotfound" || code === "etimedout";
}

function asRazorpayError(err: unknown): RazorpayRequestError {
  if (err instanceof RazorpayRequestError) return err;
  const message = err instanceof Error ? err.message : "Razorpay error";
  return new RazorpayRequestError(message, {
    reason: classifyRazorpayFailure({ message, cause: err }),
  });
}

async function razorpayFetch<T>(path: string, init?: RequestInit): Promise<T> {
  try {
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
      const description = body.error?.description ?? `Razorpay ${res.status}`;
      throw new RazorpayRequestError(description, {
        status: res.status,
        reason: classifyRazorpayFailure({ status: res.status, message: description }),
      });
    }
    return body;
  } catch (err) {
    throw asRazorpayError(err);
  }
}

export const PAYMENT_LINK_MAX_RETRIES = 2;

let retrySleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function setPaymentLinkRetrySleep(fn: ((ms: number) => Promise<void>) | null): void {
  retrySleep = fn ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
}

export function paymentLinkRetryDelayMs(retryIndex: number, random = Math.random): number {
  if (retryIndex <= 0) return 500 + Math.round(150 * random());
  return 1000 + Math.round(1000 * random());
}

export async function listFailedPayments(count = 50): Promise<RazorpayPayment[]> {
  const data = await razorpayFetch<{ items?: RazorpayPayment[] }>(`/payments?count=${count}`);
  return (data.items ?? []).filter((p) => p.status === "failed");
}

export type PaymentLinkCreateInput = {
  caseId: string;
  amountInr: number;
  name: string;
  email?: string;
  contact?: string;
  description: string;
  /** Test/retry override. Production callers omit this so every attempt is unique. */
  referenceId?: string;
};

/**
 * Razorpay rejects duplicate `reference_id` values. The RecoverAI case ID is
 * stored in notes — not used as the link reference — so a case can issue more
 * than one link (and leftover case-id references do not collide).
 */
export function paymentLinkReferenceId(caseId: string): string {
  const unique = uid("pl");
  const prefix = caseId.replace(/[^A-Za-z0-9-]/g, "").slice(0, 16);
  const joined = prefix ? `${prefix}_${unique}` : unique;
  return joined.slice(0, 40);
}

export function paymentLinkNotes(caseId: string): { recoverai_case_id: string } {
  return { recoverai_case_id: caseId };
}

export function isPaymentLinkReferenceCollision(error: string): boolean {
  return /reference_id/i.test(error) && /already exists/i.test(error);
}

export function paymentLinkCreateBody(input: PaymentLinkCreateInput): Record<string, unknown> {
  const amountPaise = Math.round(input.amountInr * 100);
  if (amountPaise < 100) throw new Error("Amount must be at least ₹1");
  const expireBy = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 3;
  const customer: Record<string, string> = { name: input.name };
  if (input.email && input.email.includes("@")) customer.email = input.email;
  const contact = input.contact?.replace(/[^\d+]/g, "");
  if (contact && contact.replace(/\D/g, "").length >= 10) customer.contact = contact;

  return {
    amount: amountPaise,
    currency: "INR",
    accept_partial: false,
    expire_by: expireBy,
    reference_id: (input.referenceId ?? paymentLinkReferenceId(input.caseId)).slice(0, 40),
    description: input.description.slice(0, 2048),
    customer,
    notify: {
      sms: Boolean(customer.contact),
      email: Boolean(customer.email),
    },
    reminder_enable: true,
    notes: paymentLinkNotes(input.caseId),
  };
}

export type PaymentLinkCreateMeta = {
  link: RazorpayPaymentLink;
  retryCount: number;
};

export async function createPaymentLink(input: PaymentLinkCreateInput): Promise<RazorpayPaymentLink> {
  return (await createPaymentLinkDetailed(input)).link;
}

export async function createPaymentLinkDetailed(input: PaymentLinkCreateInput): Promise<PaymentLinkCreateMeta> {
  const post = (referenceId: string) =>
    razorpayFetch<RazorpayPaymentLink>("/payment_links", {
      method: "POST",
      body: JSON.stringify(paymentLinkCreateBody({ ...input, referenceId })),
    });

  let lastError: RazorpayRequestError | undefined;
  for (let attempt = 0; attempt <= PAYMENT_LINK_MAX_RETRIES; attempt++) {
    const referenceId =
      attempt === 0 && input.referenceId
        ? input.referenceId.slice(0, 40)
        : paymentLinkReferenceId(input.caseId);
    try {
      const link = await post(referenceId);
      return { link, retryCount: attempt };
    } catch (err) {
      const error = asRazorpayError(err);
      error.retryCount = attempt;
      lastError = error;
      const collision = isPaymentLinkReferenceCollision(error.message);
      const retryable = collision || isTransientRazorpayFailure(error.reason);
      if (!retryable || attempt >= PAYMENT_LINK_MAX_RETRIES) throw error;
      if (!collision) await retrySleep(paymentLinkRetryDelayMs(attempt));
    }
  }
  throw lastError ?? new RazorpayRequestError("Razorpay error", { reason: "transient_error" });
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
