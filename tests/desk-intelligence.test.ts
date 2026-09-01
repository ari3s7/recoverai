import assert from "node:assert/strict";
import { test } from "node:test";
import { gatherCaseContext } from "../lib/agent/context";
import {
  groundReasoning,
  parseLlmRecommendation,
  recommendRecovery,
  recommendRecoveryHeuristic,
} from "../lib/agent/recommend";
import { diagnose } from "../lib/engine/diagnose";
import { computeDeskAnalytics, computeRecoveryForecast } from "../lib/engine/analytics";
import { recommendChannel } from "../lib/engine/channel";
import { executionFromIssuedLink } from "../lib/engine/execute";
import { buildRecoveryJourney, journeyContainsHiddenTruth } from "../lib/engine/journey";
import { formatPlannedWhen, nextQuietHoursEnd, planNextAction } from "../lib/engine/nextAction";
import { evaluatePolicy } from "../lib/engine/policy";
import { explainPolicyDecision } from "../lib/engine/policyExplain";
import { processCase } from "../lib/engine/process";
import { applyOperatorAction } from "../lib/engine/actions";
import { describePromiseLifecycle, isValidPromiseDate } from "../lib/engine/promise";
import { applyRazorpayWebhook, applyRazorpayWebhookWithMeta } from "../lib/razorpay/apply";
import { emptyWorkspace } from "../lib/db/store";
import { runWhatIf } from "../lib/evaluation/whatIf";
import { runEvaluation } from "../lib/evaluation/run";
import { DEFAULT_POLICY, policyNow } from "../lib/policy/defaults";
import { SEED_CASES } from "../lib/seed/cases";
import { generateSyntheticCases } from "../lib/seed/synthetic";
import type { RazorpayPayment } from "../lib/razorpay/client";
import { asRunCase, byName, withPolicy } from "./helpers";

const now = policyNow(DEFAULT_POLICY);

function seed(name: string) {
  return asRunCase(byName(SEED_CASES, name));
}

test("recovery journey pending until verified recovery", () => {
  const cse = seed("Ananya Mehta");
  const { diagnosis, agent } = recommendRecoveryHeuristic(cse);
  cse.diagnosis = diagnosis;
  cse.agent = agent;
  cse.policy = { allowed: true, action: "proceed", reason: "All stopping rules clear. Agent may execute a bounded play." };
  cse.executionStatus = "executed";
  cse.play = { id: "payment_link", label: "Payment link", channel: "whatsapp", reason: "link" };
  cse.execution = executionFromIssuedLink({ id: "plink_x", short_url: "https://rzp.io/i/x" }, "payment_link");
  cse.paymentLinkUrl = cse.execution.paymentLinkUrl;
  cse.outcome = { status: "at_risk", recoveredInr: 0, promisedInr: 0, note: cse.execution.message };
  const steps = buildRecoveryJourney(cse);
  assert.equal(steps.map((s) => s.id).join(">"), "detect>diagnose>ai>policy>action>outcome>confirmed");
  assert.equal(steps.find((s) => s.id === "action")?.decision, "Razorpay Payment Link created");
  assert.equal(steps.find((s) => s.id === "confirmed")?.status, "pending");
  assert.equal(cse.execution.settled, false);
  assert.equal(journeyContainsHiddenTruth(steps), false);
});

test("webhook capture marks journey recovered", () => {
  const cse = seed("Ananya Mehta");
  cse.signals.razorpayPaymentLinkId = "plink_1";
  cse.paymentLinkUrl = "https://rzp.io/i/demo";
  cse.agent = recommendRecoveryHeuristic(cse).agent;
  const ws = { ...emptyWorkspace(), cases: [cse], audit: [] };
  const payment: RazorpayPayment = {
    id: "pay_j",
    amount: cse.amountInr * 100,
    currency: "INR",
    status: "captured",
    created_at: Math.floor(Date.now() / 1000),
    notes: { recoverai_case_id: cse.id },
  };
  const next = applyRazorpayWebhook(ws, {
    event: "payment.captured",
    payment,
    link: { id: "plink_1", short_url: cse.paymentLinkUrl },
  });
  const recovered = next.cases[0]!;
  assert.equal(recovered.status, "recovered");
  assert.ok((recovered.outcome?.recoveredInr ?? 0) > 0);
  const confirmed = buildRecoveryJourney(recovered).find((s) => s.id === "confirmed");
  assert.equal(confirmed?.status, "done");
  assert.match(confirmed?.decision ?? "", /RECOVERED/);
});

test("AI recommendation display data uses scores not ground truth", () => {
  const cse = seed("Ananya Mehta");
  const { agent, context } = recommendRecoveryHeuristic(cse);
  assert.ok(agent.recommendedPlay);
  assert.ok(agent.recommendedChannel);
  assert.ok(agent.comparedPlays.length >= 1);
  assert.equal(typeof agent.recoveryProbability, "number");
  assert.equal(agent.aiPredictedRecoveryProbability, agent.recoveryProbability);
  assert.ok(agent.reasoning.length > 0);
  const blob = JSON.stringify({ agent, context });
  assert.equal(blob.includes("groundTruth"), false);
  assert.equal(blob.includes("latentOutcome"), false);
});

test("policy explanation STOP / HOLD / ESCALATE / APPROVED", async () => {
  const stopped = await processCase(seed("Farhan Ali"), DEFAULT_POLICY, now);
  const stopEx = explainPolicyDecision(stopped);
  assert.equal(stopEx.headline, "BLOCKED");
  assert.equal(stopEx.override, "STOP");
  assert.ok(stopEx.aiRecommendation);

  const held = await processCase(seed("Diya Nair"), DEFAULT_POLICY, now);
  assert.equal(explainPolicyDecision(held).headline, "HELD");
  assert.equal(explainPolicyDecision(held).override, "HOLD");

  const escalated = await processCase(seed("Neel Logistics"), DEFAULT_POLICY, now);
  const esc = explainPolicyDecision(escalated);
  assert.equal(esc.headline, "ESCALATED");
  assert.match(esc.override ?? "", /Human approval/);

  const queued = await processCase(seed("Ananya Mehta"), withPolicy({ autoExecute: false }), now);
  assert.equal(explainPolicyDecision(queued).headline, "QUEUED");

  const ananya = seed("Ananya Mehta");
  const okPolicy = evaluatePolicy(ananya, DEFAULT_POLICY, now);
  ananya.policy = okPolicy;
  ananya.executionStatus = "executed";
  assert.equal(explainPolicyDecision(ananya).headline, "APPROVED");
  assert.match(explainPolicyDecision(ananya).reason, /stopping rules clear/i);
});

test("STOP HOLD ESCALATE still block outbound on journey action step", async () => {
  for (const name of ["Farhan Ali", "Diya Nair", "Neel Logistics"] as const) {
    const next = await processCase(seed(name), DEFAULT_POLICY, now);
    const action = buildRecoveryJourney(next).find((s) => s.id === "action");
    assert.equal(action?.status, "blocked");
    assert.equal(next.execution?.settled, false);
  }
});

test("channel recommendation uses customer preference and is not a send", () => {
  const email = seed("Ananya Mehta");
  email.customer.channelPref = "email";
  assert.equal(recommendChannel(email, "payment_link"), "email");
  assert.equal(recommendChannel(email, "hinglish_voice"), "voice");
  assert.equal(recommendChannel(email, "smart_retry"), "payments");
  const rec = recommendRecoveryHeuristic(email).agent;
  assert.equal(rec.recommendedChannel, recommendChannel(email, rec.recommendedPlay));
});

test("quiet hours next action is planned not executed", async () => {
  const policy = withPolicy({ sandboxClockIso: "2026-08-26T22:15:00+05:30" });
  const at = policyNow(policy);
  const next = await processCase(seed("Ananya Mehta"), policy, at);
  assert.equal(next.executionStatus, "held");
  const plan = planNextAction(next, policy, at);
  assert.ok(plan);
  assert.equal(plan?.waitingOn, "quiet_hours");
  assert.ok(plan?.at);
  const until = nextQuietHoursEnd(policy, at);
  assert.equal(until.toISOString(), new Date("2026-08-27T09:00:00+05:30").toISOString());
  assert.match(formatPlannedWhen(plan!.at!, at), /Tomorrow/i);
});

test("contact cap and retry limit stay authoritative", () => {
  const cap = seed("Ananya Mehta");
  cap.signals.contactsLast7Days = 3;
  const verdict = evaluatePolicy(cap, DEFAULT_POLICY, now);
  assert.equal(verdict.action, "stop");
  assert.equal(verdict.ruleId, "contact-cap");
  const plan = planNextAction(
    { ...cap, policy: verdict, status: "stopped" },
    DEFAULT_POLICY,
    now,
  );
  assert.ok(plan?.reason.includes("Contact cap") || plan?.waitingOn === "none");
});

test("PTP lifecycle promised → fulfilled and broken re-enters policy", async () => {
  const cse = seed("Ananya Mehta");
  const promised = await applyOperatorAction(
    cse,
    { type: "capture_promise", date: "2026-09-10" },
    DEFAULT_POLICY,
  );
  assert.equal(describePromiseLifecycle(promised, now).state, "promised");
  const dup = await applyOperatorAction(
    promised,
    { type: "capture_promise", date: "2026-09-10" },
    DEFAULT_POLICY,
  );
  assert.equal(dup.timeline.length, promised.timeline.length);

  const paid = await applyOperatorAction(
    promised,
    { type: "mark_recovered", note: "PTP fulfilled" },
    DEFAULT_POLICY,
  );
  const life = describePromiseLifecycle(paid, now);
  assert.equal(life.state, "fulfilled");
  assert.equal(life.recoveredInr, cse.amountInr);

  const broken = seed("Saffron Traders");
  broken.signals.promiseToPayDate = "2026-08-01";
  assert.equal(describePromiseLifecycle(broken, now).state, "broken");
  assert.equal(describePromiseLifecycle(broken, now).eligibleForRerun, true);
  const rerun = await processCase(broken, DEFAULT_POLICY, now);
  assert.notEqual(rerun.policy?.ruleId, "promise-to-pay");
  assert.ok(rerun.agent);
});

test("desk analytics and forecast use live case state", async () => {
  const recovered = await applyOperatorAction(
    seed("Ananya Mehta"),
    { type: "mark_recovered" },
    DEFAULT_POLICY,
  );
  const stopped = await processCase(seed("Farhan Ali"), DEFAULT_POLICY, now);
  const analytics = computeDeskAnalytics([recovered, stopped], now);
  assert.equal(analytics.verifiedRecoveredInr, recovered.amountInr);
  assert.equal(analytics.stoppedCount, 1);
  assert.equal(analytics.recoveryRate > 0, true);
  const forecast = computeRecoveryForecast([recovered, stopped]);
  assert.equal(forecast.verifiedRecoveredInr, recovered.amountInr);
  const blob = JSON.stringify({ analytics, forecast });
  assert.equal(blob.includes("groundTruth"), false);
  assert.equal(blob.includes("latentOutcome"), false);
});

test("what-if simulation does not change saved policy metrics identity", async () => {
  const same = await runWhatIf({
    currentPolicy: DEFAULT_POLICY,
    proposedPolicy: DEFAULT_POLICY,
    dataset: "seed",
  });
  assert.equal(same.kind, "whatif");
  assert.equal(same.simulated, true);
  assert.equal(same.savedPolicyUnchanged, true);
  assert.equal(same.delta.recoveredInr, 0);
  assert.equal(same.delta.actionCount, 0);
  assert.equal(same.current.llmCalls, 0);
  assert.equal(same.proposed.llmCalls, 0);
  assert.equal(same.current.paired, true);

  const tighter = await runWhatIf({
    currentPolicy: DEFAULT_POLICY,
    proposedPolicy: { ...DEFAULT_POLICY, highAovInr: 5_000 },
    dataset: "seed",
  });
  assert.ok(tighter.delta.escalatedCount !== 0 || tighter.delta.recoveredInr !== 0);
});

test("paired evaluation remains deterministic with llmCalls 0", async () => {
  const a = await runEvaluation({ dataset: "synthetic", syntheticCount: 80, policy: DEFAULT_POLICY });
  const b = await runEvaluation({ dataset: "synthetic", syntheticCount: 80, policy: DEFAULT_POLICY });
  assert.equal(a.llmCalls, 0);
  assert.equal(a.policy.recoveredInr, b.policy.recoveredInr);
});

test("synthetic ground truth never appears on journey or recommendation", () => {
  const syn = generateSyntheticCases(4);
  for (const s of syn) {
    const cse = asRunCase(s);
    const { agent, context } = recommendRecoveryHeuristic(cse);
    cse.agent = agent;
    const steps = buildRecoveryJourney(cse);
    const blob = JSON.stringify({ steps, agent, context });
    assert.ok(s.groundTruthPropensity !== undefined);
    assert.equal(blob.includes("groundTruthPropensity"), false);
    assert.equal(blob.includes("latentOutcomeSeed"), false);
    assert.equal(JSON.stringify(gatherCaseContext(cse)).includes("latentOutcome"), false);
  }
});

test("AI payment link is not recovered until capture", async () => {
  const cse = seed("Ananya Mehta");
  cse.agent = recommendRecoveryHeuristic(cse).agent;
  cse.agent.recommendedPlay = "payment_link";
  cse.policy = { allowed: true, action: "proceed", reason: "All stopping rules clear. Agent may execute a bounded play." };
  cse.executionStatus = "executed";
  cse.play = { id: "payment_link", label: "Payment link", channel: "whatsapp", reason: "link" };
  cse.execution = executionFromIssuedLink({ id: "plink_ready", short_url: "https://rzp.io/i/x" }, "payment_link");
  cse.paymentLinkUrl = cse.execution.paymentLinkUrl;
  cse.outcome = { status: "at_risk", recoveredInr: 0, promisedInr: 0, note: cse.execution.message };
  assert.equal(cse.execution.settled, false);
  assert.equal(cse.outcome.recoveredInr, 0);
  assert.equal(buildRecoveryJourney(cse).find((s) => s.id === "confirmed")?.status, "pending");
});

test("duplicate capture does not double recovered amount", () => {
  const cse = seed("Ananya Mehta");
  cse.signals.razorpayPaymentLinkId = "plink_dup";
  const ws = { ...emptyWorkspace(), cases: [cse], audit: [] };
  const payment: RazorpayPayment = {
    id: "pay_dup",
    amount: cse.amountInr * 100,
    currency: "INR",
    status: "captured",
    created_at: Math.floor(Date.now() / 1000),
    notes: { recoverai_case_id: cse.id },
  };
  const once = applyRazorpayWebhook(ws, { event: "payment.captured", payment, link: { id: "plink_dup" } });
  const twice = applyRazorpayWebhookWithMeta(once, { event: "payment.captured", payment, link: { id: "plink_dup" } });
  assert.equal(twice.meta.duplicate, true);
  assert.equal(twice.workspace.cases[0]?.outcome?.recoveredInr, cse.amountInr);
  assert.equal(twice.workspace.cases[0]?.timeline.filter((e) => e.action === "PAYMENT_OUTCOME").length, 1);
});

test("unmatched capture webhook does not invent recovery", () => {
  const ws = { ...emptyWorkspace(), cases: [seed("Ananya Mehta")], audit: [] };
  const payment: RazorpayPayment = {
    id: "pay_orphan",
    amount: 10000,
    currency: "INR",
    status: "captured",
    created_at: Math.floor(Date.now() / 1000),
    notes: { recoverai_case_id: "NV-MISSING" },
  };
  const result = applyRazorpayWebhookWithMeta(ws, { event: "payment.captured", payment });
  assert.equal(result.meta.matched, false);
  assert.equal(result.workspace.cases[0]?.status, "at_risk");
  assert.equal(result.workspace.cases[0]?.outcome?.recoveredInr ?? 0, 0);
});

test("contact cap BLOCKS recommended play", async () => {
  const cse = seed("Ananya Mehta");
  cse.signals.contactsLast7Days = 3;
  const next = await processCase(cse, DEFAULT_POLICY, now);
  assert.ok(next.agent);
  assert.equal(next.policy?.action, "stop");
  assert.equal(next.policy?.ruleId, "contact-cap");
  assert.equal(explainPolicyDecision(next).headline, "BLOCKED");
  assert.equal(next.executionStatus, "blocked");
  assert.equal(next.outcome?.recoveredInr ?? 0, 0);
  assert.ok(!next.timeline.some((e) => e.action === "ACTION_EXECUTED"));
});

test("quiet hours HOLD recommended play", async () => {
  const next = await processCase(seed("Diya Nair"), DEFAULT_POLICY, now);
  assert.ok(next.agent);
  assert.equal(next.policy?.action, "hold");
  assert.equal(explainPolicyDecision(next).headline, "HELD");
  assert.equal(next.executionStatus, "held");
  assert.equal(next.outcome?.recoveredInr ?? 0, 0);
});

test("high-value case is ESCALATED not auto-executed", async () => {
  const next = await processCase(seed("Neel Logistics"), DEFAULT_POLICY, now);
  assert.ok(next.agent);
  assert.equal(next.policy?.action, "escalate");
  assert.equal(explainPolicyDecision(next).headline, "ESCALATED");
  assert.equal(next.executionStatus, "escalated");
  assert.equal(next.play?.id, "human_escalate");
  assert.equal(next.outcome?.recoveredInr ?? 0, 0);
});

test("revoked mandate recommends payment link not retry", async () => {
  const cse = seed("Bhavya Shah");
  const rec = recommendRecoveryHeuristic(cse);
  assert.equal(rec.agent.recommendedPlay, "payment_link");
  const next = await processCase(cse, DEFAULT_POLICY, now);
  if (next.policy?.action === "proceed") {
    assert.notEqual(next.play?.id, "smart_retry");
  }
  assert.notEqual(next.agent?.recommendedPlay, "smart_retry");
});

test("invalid LLM JSON falls back to heuristic", async () => {
  const cse = seed("Ananya Mehta");
  const dx = diagnose(cse);
  assert.equal(
    parseLlmRecommendation({ recommendedPlay: "not-a-play" }, cse, dx, [], "openai"),
    null,
  );
  const { agent } = await recommendRecovery(cse, { forceHeuristic: true });
  assert.equal(agent.provider, "heuristic");
  assert.ok(agent.recommendedPlay);
});

test("grounded reasoning drops hidden-truth claims", () => {
  const cleaned = groundReasoning(
    ["7/9 previous payments succeeded", "groundTruthPropensity is 0.9", "already recovered"],
    ["fallback evidence"],
  );
  assert.deepEqual(cleaned, ["7/9 previous payments succeeded"]);
  assert.deepEqual(groundReasoning(["latentOutcomeSeed 0.2"], ["observable"]), ["observable"]);
});

test("invalid PTP date is rejected", async () => {
  assert.equal(isValidPromiseDate("not-a-date"), false);
  await assert.rejects(
    () =>
      applyOperatorAction(seed("Ananya Mehta"), { type: "capture_promise", date: "tomorrow" }, DEFAULT_POLICY),
    /Invalid promise date/,
  );
});

test("duplicate mark_recovered does not double count", async () => {
  const first = await applyOperatorAction(seed("Ananya Mehta"), { type: "mark_recovered" }, DEFAULT_POLICY);
  const second = await applyOperatorAction(first, { type: "mark_recovered" }, DEFAULT_POLICY);
  assert.equal(second.timeline.length, first.timeline.length);
  assert.equal(second.outcome?.recoveredInr, first.amountInr);
});

test("PTP due state is the promise calendar date", () => {
  const cse = seed("Ananya Mehta");
  cse.status = "promised";
  cse.signals.promiseToPayDate = "2026-08-26";
  cse.outcome = {
    status: "promised",
    recoveredInr: 0,
    promisedInr: cse.amountInr,
    promisedDate: "2026-08-26",
    note: "due today",
  };
  assert.equal(describePromiseLifecycle(cse, now).state, "due");
  assert.equal(describePromiseLifecycle(cse, now).eligibleForRerun, true);
});

test("what-if does not mutate the saved policy object", async () => {
  const saved = { ...DEFAULT_POLICY };
  const proposed = { ...DEFAULT_POLICY, maxContactsPer7Days: 9 };
  await runWhatIf({ currentPolicy: saved, proposedPolicy: proposed, dataset: "seed" });
  assert.equal(saved.maxContactsPer7Days, DEFAULT_POLICY.maxContactsPer7Days);
  assert.equal(proposed.maxContactsPer7Days, 9);
});
