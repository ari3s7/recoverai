import assert from "node:assert/strict";
import { test } from "node:test";
import {
  describeMandateSequence,
  mandateCooldownActive,
  mandateRetryCount,
  nextMandateStep,
} from "../lib/engine/mandate";
import { processCase } from "../lib/engine/process";
import { DEFAULT_POLICY, policyNow } from "../lib/policy/defaults";
import { SEED_CASES } from "../lib/seed/cases";
import { asRunCase, byName } from "./helpers";

const now = policyNow(DEFAULT_POLICY);

test("mandate retry #1 is eligible for NSF", () => {
  const cse = asRunCase(byName(SEED_CASES, "Tejas Kulkarni"));
  cse.signals.mandateRetryCount = 0;
  cse.signals.lastRetryAt = undefined;
  cse.signals.lastContactAt = undefined;
  cse.signals.declineCode = "INSUFFICIENT_FUNDS";
  assert.equal(nextMandateStep(cse, DEFAULT_POLICY, now), "smart_retry");
  const seq = describeMandateSequence(cse, DEFAULT_POLICY, now);
  assert.equal(seq.attempt, 0);
  assert.equal(seq.nextEligiblePlay, "smart_retry");
  assert.equal(seq.currentState, "retry_eligible");
});

test("mandate retry #2 stays bounded", () => {
  const cse = asRunCase(byName(SEED_CASES, "Tejas Kulkarni"));
  cse.signals.mandateRetryCount = 1;
  cse.signals.lastRetryAt = undefined;
  cse.signals.lastContactAt = undefined;
  cse.signals.declineCode = "INSUFFICIENT_FUNDS";
  assert.equal(mandateRetryCount(cse), 1);
  assert.equal(nextMandateStep(cse, DEFAULT_POLICY, now), "smart_retry");
});

test("mandate retry limit switches to payment link", () => {
  const cse = asRunCase(byName(SEED_CASES, "Tejas Kulkarni"));
  cse.signals.mandateRetryCount = 2;
  cse.signals.declineCode = "INSUFFICIENT_FUNDS";
  assert.equal(nextMandateStep(cse, DEFAULT_POLICY, now), "payment_link");
  assert.equal(describeMandateSequence(cse, DEFAULT_POLICY, now).currentState, "capped");
});

test("mandate cooldown is respected", () => {
  const cse = asRunCase(byName(SEED_CASES, "Tejas Kulkarni"));
  cse.signals.mandateRetryCount = 0;
  cse.signals.declineCode = "INSUFFICIENT_FUNDS";
  cse.signals.lastRetryAt = "2026-08-26T10:00:00+05:30";
  assert.equal(mandateCooldownActive(cse, DEFAULT_POLICY, now), true);
  assert.equal(nextMandateStep(cse, DEFAULT_POLICY, now), "payment_link");
});

test("mandate recovery window is respected", () => {
  const cse = asRunCase(byName(SEED_CASES, "Tejas Kulkarni"));
  cse.occurredAt = "2026-07-01T00:00:00+05:30";
  cse.signals.recoveryWindowDays = 14;
  assert.equal(nextMandateStep(cse, DEFAULT_POLICY, now), "stop");
  assert.equal(describeMandateSequence(cse, DEFAULT_POLICY, now).outcome, "stopped");
});

test("revoked mandate never retries the dead token", () => {
  const cse = asRunCase(byName(SEED_CASES, "Bhavya Shah"));
  assert.equal(nextMandateStep(cse, DEFAULT_POLICY, now), "payment_link");
  assert.equal(describeMandateSequence(cse, DEFAULT_POLICY, now).currentState, "revoked");
});

test("successful payment stops further mandate retries", async () => {
  const cse = asRunCase(byName(SEED_CASES, "Tejas Kulkarni"));
  cse.status = "recovered";
  cse.outcome = { status: "recovered", recoveredInr: cse.amountInr, promisedInr: 0, note: "paid" };
  const next = await processCase(cse, DEFAULT_POLICY, now);
  assert.equal(next.status, "recovered");
  assert.ok(next.timeline.at(-1)?.reason.includes("already succeeded"));
});
