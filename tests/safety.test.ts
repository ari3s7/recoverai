import assert from "node:assert/strict";
import { test } from "node:test";
import { processCase } from "../lib/engine/process";
import { evaluatePolicy } from "../lib/engine/policy";
import { clampPlayToPolicy } from "../lib/engine/policy";
import { DEFAULT_POLICY, policyNow } from "../lib/policy/defaults";
import { SEED_CASES } from "../lib/seed/cases";
import { asRunCase, byName, withPolicy } from "./helpers";

const now = policyNow(DEFAULT_POLICY);

function seed(name: string) {
  return asRunCase(byName(SEED_CASES, name));
}

test("policy STOP (DNC) prevents execution and outbound contact", async () => {
  const before = seed("Farhan Ali");
  const contacts = before.signals.contactsLast7Days;
  const next = await processCase(before, DEFAULT_POLICY, now);
  assert.equal(next.policy?.action, "stop");
  assert.equal(next.policy?.ruleId, "dnc");
  assert.equal(next.executionStatus, "blocked");
  assert.equal(next.status, "stopped");
  assert.equal(next.execution?.settled, false);
  assert.equal(next.paymentLinkUrl, undefined);
  assert.equal(next.signals.contactsLast7Days, contacts);
  assert.ok(next.timeline.some((e) => e.action === "ACTION_BLOCKED"));
  assert.ok(!next.timeline.some((e) => e.action === "ACTION_EXECUTED"));
});

test("policy STOP (complaint) prevents execution", async () => {
  const next = await processCase(seed("Kabir Singh"), DEFAULT_POLICY, now);
  assert.equal(next.policy?.ruleId, "complaint");
  assert.equal(next.executionStatus, "blocked");
  assert.equal(next.status, "stopped");
  assert.equal(next.execution?.provider, "policy");
});

test("policy STOP (legal) prevents execution", async () => {
  const next = await processCase(seed("Kiran Textiles"), DEFAULT_POLICY, now);
  assert.equal(next.policy?.ruleId, "legal-hold");
  assert.equal(next.executionStatus, "blocked");
  assert.equal(next.status, "stopped");
});

test("policy STOP (fraud) prevents execution", async () => {
  const next = await processCase(seed("Dev Malhotra"), DEFAULT_POLICY, now);
  assert.equal(next.policy?.ruleId, "fraud-chargeback");
  assert.equal(next.executionStatus, "blocked");
});

test("policy STOP (chargeback) prevents execution", async () => {
  const next = await processCase(seed("Varun Chopra"), DEFAULT_POLICY, now);
  assert.equal(next.policy?.ruleId, "fraud-chargeback");
  assert.equal(next.executionStatus, "blocked");
});

test("policy HOLD (quiet hours flag) prevents execution", async () => {
  const next = await processCase(seed("Diya Nair"), DEFAULT_POLICY, now);
  assert.equal(next.policy?.action, "hold");
  assert.equal(next.policy?.ruleId, "quiet-hours");
  assert.equal(next.executionStatus, "held");
  assert.equal(next.status, "held");
  assert.ok(next.timeline.some((e) => e.action === "ACTION_HELD"));
  assert.equal(next.paymentLinkUrl, undefined);
});

test("policy HOLD (quiet hours by clock) prevents execution", async () => {
  const policy = withPolicy({ sandboxClockIso: "2026-08-26T22:15:00+05:30" });
  const next = await processCase(seed("Ananya Mehta"), policy, policyNow(policy));
  assert.equal(next.policy?.ruleId, "quiet-hours");
  assert.equal(next.executionStatus, "held");
});

test("active Promise-to-Pay causes HOLD and no outbound", async () => {
  const next = await processCase(seed("Saffron Traders"), DEFAULT_POLICY, now);
  assert.equal(next.policy?.action, "hold");
  assert.equal(next.policy?.ruleId, "promise-to-pay");
  assert.equal(next.executionStatus, "held");
  assert.equal(next.status, "promised");
  assert.equal(next.paymentLinkUrl, undefined);
});

test("policy ESCALATE (high-AOV B2B) prevents AI play execution", async () => {
  const next = await processCase(seed("Neel Logistics"), DEFAULT_POLICY, now);
  assert.equal(next.policy?.action, "escalate");
  assert.equal(next.executionStatus, "escalated");
  assert.equal(next.status, "escalated");
  assert.equal(next.play?.id, "human_escalate");
  assert.equal(next.paymentLinkUrl, undefined);
  assert.ok(next.agent);
  assert.ok(next.timeline.some((e) => e.action === "ACTION_ESCALATED"));
  assert.ok(!next.timeline.some((e) => e.action === "ACTION_EXECUTED"));
});

test("autoExecute=false prevents execution and queues the case", async () => {
  const policy = withPolicy({ autoExecute: false });
  const before = seed("Ananya Mehta");
  const next = await processCase(before, policy, now);
  assert.equal(next.policy?.action, "proceed");
  assert.equal(next.executionStatus, "queued");
  assert.equal(next.status, "escalated");
  assert.equal(next.execution?.settled, false);
  assert.equal(next.paymentLinkUrl, undefined);
  assert.equal(next.signals.contactsLast7Days, before.signals.contactsLast7Days);
  assert.ok(next.timeline.some((e) => e.action === "ACTION_QUEUED"));
  assert.ok(next.agent);
});

test("max retries prevents smart_retry", () => {
  const cse = seed("Vikram Shah");
  cse.signals.retryCount = 3;
  const verdict = evaluatePolicy(cse, DEFAULT_POLICY, now);
  assert.equal(verdict.action, "proceed");
  assert.equal(clampPlayToPolicy("smart_retry", cse, DEFAULT_POLICY, verdict, now), "payment_link");
});

test("expired recovery window stops action", async () => {
  const cse = seed("Ananya Mehta");
  cse.occurredAt = "2026-07-01T00:00:00+05:30";
  cse.signals.recoveryWindowDays = 14;
  const next = await processCase(cse, DEFAULT_POLICY, now);
  assert.equal(next.policy?.ruleId, "recovery-window");
  assert.equal(next.executionStatus, "blocked");
  assert.equal(next.status, "stopped");
});
