import assert from "node:assert/strict";
import { test } from "node:test";
import { applyOperatorAction } from "../lib/engine/actions";
import { processCase } from "../lib/engine/process";
import { isActivePromise, isBreachedPromise } from "../lib/engine/promise";
import { DEFAULT_POLICY, policyNow } from "../lib/policy/defaults";
import { SEED_CASES } from "../lib/seed/cases";
import { asRunCase, byName } from "./helpers";

const now = policyNow(DEFAULT_POLICY);

test("promise creation works", async () => {
  const cse = asRunCase(byName(SEED_CASES, "Ananya Mehta"));
  const next = await applyOperatorAction(
    cse,
    { type: "capture_promise", date: "2026-09-10", note: "Will pay after payroll" },
    DEFAULT_POLICY,
  );
  assert.equal(next.status, "promised");
  assert.equal(next.signals.promiseToPayDate, "2026-09-10");
  assert.equal(next.outcome?.promisedInr, cse.amountInr);
  assert.equal(isActivePromise(next, now), true);
});

test("active promise causes hold", async () => {
  const next = await processCase(asRunCase(byName(SEED_CASES, "Saffron Traders")), DEFAULT_POLICY, now);
  assert.equal(next.policy?.ruleId, "promise-to-pay");
  assert.equal(next.executionStatus, "held");
  assert.equal(next.status, "promised");
});

test("fulfilled promise is marked fulfilled via operator recover", async () => {
  const cse = asRunCase(byName(SEED_CASES, "Saffron Traders"));
  const promised = await applyOperatorAction(
    cse,
    { type: "capture_promise", date: "2026-09-04" },
    DEFAULT_POLICY,
  );
  const paid = await applyOperatorAction(
    promised,
    { type: "mark_recovered", note: "PTP fulfilled" },
    DEFAULT_POLICY,
  );
  assert.equal(paid.status, "recovered");
  assert.equal(paid.outcome?.recoveredInr, cse.amountInr);
  assert.equal(paid.signals.promiseToPayDate, undefined);
});

test("duplicate promise for the same date is ignored", async () => {
  const cse = asRunCase(byName(SEED_CASES, "Ananya Mehta"));
  const first = await applyOperatorAction(
    cse,
    { type: "capture_promise", date: "2026-09-10" },
    DEFAULT_POLICY,
  );
  const second = await applyOperatorAction(
    first,
    { type: "capture_promise", date: "2026-09-10" },
    DEFAULT_POLICY,
  );
  assert.equal(second.timeline.length, first.timeline.length);
  assert.equal(second.signals.promiseToPayDate, "2026-09-10");
});

test("breached promise follows remaining policy", async () => {
  const cse = asRunCase(byName(SEED_CASES, "Saffron Traders"));
  cse.signals.promiseToPayDate = "2026-08-01";
  assert.equal(isBreachedPromise(cse, now), true);
  assert.equal(isActivePromise(cse, now), false);
  const next = await processCase(cse, DEFAULT_POLICY, now);
  assert.notEqual(next.policy?.ruleId, "promise-to-pay");
  assert.ok(next.timeline.some((e) => e.reason.includes("past due")));
});
