import assert from "node:assert/strict";
import { test } from "node:test";
import { emptyWorkspace } from "../lib/db/store";
import { executionFromFailedLink, executionFromIssuedLink } from "../lib/engine/execute";
import { applyRazorpayWebhook } from "../lib/razorpay/apply";
import type { RazorpayPayment } from "../lib/razorpay/client";
import { asRunCase } from "./helpers";
import { SEED_CASES } from "../lib/seed/cases";

test("Payment Link creation does not mark recovered", () => {
  const result = executionFromIssuedLink(
    { id: "plink_test", short_url: "https://rzp.io/i/demo" },
    "payment_link",
  );
  assert.equal(result.ok, true);
  assert.equal(result.settled, false);
  assert.equal(result.provider, "razorpay");
  assert.ok(result.paymentLinkUrl);
});

test("failed Payment Link creation does not mark recovered", () => {
  const result = executionFromFailedLink("gateway timeout");
  assert.equal(result.ok, false);
  assert.equal(result.settled, false);
  assert.equal(result.provider, "razorpay");
});

test("successful webhook marks recovered", () => {
  const seed = asRunCase(SEED_CASES[0]!);
  seed.signals.razorpayPaymentLinkId = "plink_1";
  seed.paymentLinkUrl = "https://rzp.io/i/demo";
  seed.status = "at_risk";
  const ws = { ...emptyWorkspace(), cases: [seed], audit: [] };
  const payment: RazorpayPayment = {
    id: "pay_1",
    amount: seed.amountInr * 100,
    currency: "INR",
    status: "captured",
    created_at: Math.floor(Date.now() / 1000),
    notes: { recoverai_case_id: seed.id },
  };
  const next = applyRazorpayWebhook(ws, {
    event: "payment.captured",
    payment,
    link: { id: "plink_1", short_url: seed.paymentLinkUrl },
  });
  const cse = next.cases[0]!;
  assert.equal(cse.status, "recovered");
  assert.equal(cse.outcome?.recoveredInr, seed.amountInr);
  assert.equal(cse.execution?.settled, true);
});

test("duplicate webhook is idempotent", () => {
  const seed = asRunCase(SEED_CASES[0]!);
  seed.signals.razorpayPaymentLinkId = "plink_1";
  const ws = { ...emptyWorkspace(), cases: [seed], audit: [] };
  const payment: RazorpayPayment = {
    id: "pay_1",
    amount: seed.amountInr * 100,
    currency: "INR",
    status: "captured",
    created_at: Math.floor(Date.now() / 1000),
    notes: { recoverai_case_id: seed.id },
  };
  const once = applyRazorpayWebhook(ws, { event: "payment.captured", payment, link: { id: "plink_1" } });
  const twice = applyRazorpayWebhook(once, { event: "payment.captured", payment, link: { id: "plink_1" } });
  const cse = twice.cases[0]!;
  assert.equal(cse.status, "recovered");
  const outcomes = cse.timeline.filter((e) => e.action === "PAYMENT_OUTCOME");
  assert.equal(outcomes.length, 1);
  assert.equal(cse.outcome?.recoveredInr, seed.amountInr);
});
