import { inr } from "../format";
import { uid } from "../ids";
import {
  createPaymentLinkDetailed,
  razorpayConfigured,
  RazorpayRequestError,
} from "../razorpay/client";
import type { ExecutionResult, Play, RazorpayFailureReason, RootCause, SeedCase } from "../types";
import { settleAgainstGroundTruth } from "./groundTruth";
export { sandboxUnit } from "./hash";

const FIT: Record<RootCause, Partial<Record<Play["id"], number>>> = {
  insufficient_funds: { smart_retry: 0.52, hinglish_voice: 0.4, payment_link: 0.36 },
  expired_card: { payment_link: 0.74, hinglish_voice: 0.58, smart_retry: 0.08 },
  bank_decline: { hinglish_voice: 0.38, payment_link: 0.3, smart_retry: 0.18 },
  mandate_revoked: { payment_link: 0.46 },
  price_shock: { hinglish_voice: 0.56, payment_link: 0.28 },
  checkout_friction: { payment_link: 0.44, hinglish_voice: 0.33 },
  payment_page_drop: { hinglish_voice: 0.5, payment_link: 0.34 },
  retry_exhausted: { payment_link: 0.41, hinglish_voice: 0.36 },
  cashflow_delay: { promise_to_pay: 0.88, payment_link: 0.22 },
  dispute_unaware: { payment_link: 0.37, human_escalate: 0 },
  forgotten_renewal: { hinglish_voice: 0.61, payment_link: 0.48 },
};

export function recoveryProbability(cause: RootCause, playId: Play["id"]): number {
  return FIT[cause]?.[playId] ?? 0.2;
}

function executeSandbox(seed: SeedCase, play: Play, cause: RootCause): ExecutionResult {
  const referenceId = uid("exec");
  if (play.id === "stop") {
    return {
      ok: true,
      settled: false,
      provider: "policy",
      referenceId,
      message: "No outbound. Policy bound the workflow.",
    };
  }
  if (play.id === "human_escalate") {
    return {
      ok: true,
      settled: false,
      provider: "operator",
      referenceId,
      message: `Queued for a human closer. ${inr(seed.amountInr)} is above the auto-touch ceiling.`,
    };
  }
  if (play.id === "promise_to_pay") {
    return {
      ok: true,
      settled: false,
      provider: "sandbox.comms",
      referenceId,
      message: "Promise-to-pay captured. Retries paused until the committed date.",
    };
  }

  const recovered = settleAgainstGroundTruth(seed, cause, play.id);

  if (play.id === "smart_retry") {
    return {
      ok: recovered,
      settled: recovered,
      provider: "sandbox.payments",
      referenceId,
      message: recovered
        ? `Delayed debit succeeded (${seed.signals.declineCode ?? "NSF"}).`
        : `Delayed debit still declined (${seed.signals.declineCode ?? "NSF"}). Next cycle requires a new instrument.`,
    };
  }
  if (play.id === "hinglish_voice") {
    return {
      ok: recovered,
      settled: recovered,
      provider: "sandbox.voice",
      referenceId,
      message: recovered
        ? "Voice session completed. Customer paid on the live link."
        : "Voice session completed. No payment this cycle. Sequence stops.",
    };
  }
  return {
    ok: recovered,
    settled: recovered,
    provider: "sandbox.comms",
    referenceId,
    message: recovered
      ? `Payment link converted on ${play.channel}.`
      : `Payment link delivered on ${play.channel}. Not converted this cycle.`,
  };
}

export function paymentLinkFailureMessage(reason: RazorpayFailureReason): string {
  if (reason === "rate_limited") {
    return "Razorpay temporarily rate-limited this request. No recovery recorded.";
  }
  if (reason === "timeout") {
    return "Razorpay request timed out. No recovery recorded.";
  }
  if (reason === "transient_error") {
    return "Razorpay request failed temporarily. No recovery recorded.";
  }
  return "Razorpay rejected the payment-link request. No recovery recorded.";
}

export function executionFromIssuedLink(
  link: { id: string; short_url: string },
  playId: Play["id"],
  extra?: { retryCount?: number },
): ExecutionResult {
  return {
    ok: true,
    settled: false,
    provider: "razorpay",
    referenceId: link.id,
    paymentLinkUrl: link.short_url,
    retryCount: extra?.retryCount,
    message:
      playId === "smart_retry"
        ? `Razorpay will not re-debit a failed instrument. New payment link issued: ${link.short_url}`
        : `Razorpay payment link issued: ${link.short_url}`,
  };
}

export function executionFromFailedLink(
  why: string | RazorpayFailureReason,
  extra?: { failureReason?: RazorpayFailureReason; retryCount?: number },
): ExecutionResult {
  const failureReason =
    extra?.failureReason ??
    (why === "rate_limited" || why === "transient_error" || why === "timeout" || why === "permanent_error"
      ? why
      : why.toLowerCase().includes("too many") || why.toLowerCase().includes("rate limit")
        ? "rate_limited"
        : why.toLowerCase().includes("timeout") || why.toLowerCase().includes("timed out")
          ? "timeout"
          : "permanent_error");
  return {
    ok: false,
    settled: false,
    provider: "razorpay",
    referenceId: uid("exec"),
    failureReason,
    retryCount: extra?.retryCount,
    message: paymentLinkFailureMessage(failureReason),
  };
}

export function existingUnpaidPaymentLink(seed: SeedCase): { id: string; short_url: string } | undefined {
  const id = seed.signals.razorpayPaymentLinkId;
  const short_url = "paymentLinkUrl" in seed ? (seed as { paymentLinkUrl?: string }).paymentLinkUrl : undefined;
  if (!id?.startsWith("plink_") || !short_url) return undefined;
  if (!/^https?:\/\//i.test(short_url)) return undefined;
  return { id, short_url };
}

export async function executePlay(seed: SeedCase, play: Play, cause: RootCause): Promise<ExecutionResult> {
  const sandbox = executeSandbox(seed, play, cause);
  const wantsLink =
    play.id === "payment_link" || play.id === "smart_retry" || play.id === "hinglish_voice";
  if (!razorpayConfigured() || !wantsLink) return sandbox;

  const existing = existingUnpaidPaymentLink(seed);
  if (existing) {
    return executionFromIssuedLink(existing, play.id, { retryCount: 0 });
  }

  try {
    const created = await createPaymentLinkDetailed({
      caseId: seed.id,
      amountInr: seed.amountInr,
      name: seed.customer.name,
      email: seed.customer.email,
      contact: seed.customer.contact,
      description: `Nivaara recovery ${seed.id} · ${play.label}`,
    });
    return executionFromIssuedLink(created.link, play.id, { retryCount: created.retryCount });
  } catch (err) {
    const error = err instanceof RazorpayRequestError ? err : undefined;
    const why = err instanceof Error ? err.message : "Razorpay error";
    return executionFromFailedLink(why, {
      failureReason: error?.reason,
      retryCount: error?.retryCount,
    });
  }
}
