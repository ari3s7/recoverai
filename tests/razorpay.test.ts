import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { emptyWorkspace } from "../lib/db/store";
import {
  executePlay,
  executionFromFailedLink,
  executionFromIssuedLink,
} from "../lib/engine/execute";
import { processCase } from "../lib/engine/process";
import { DEFAULT_POLICY, policyNow } from "../lib/policy/defaults";
import { applyRazorpayWebhook } from "../lib/razorpay/apply";
import {
  createPaymentLink,
  isPaymentLinkReferenceCollision,
  paymentLinkCreateBody,
  paymentLinkNotes,
  paymentLinkReferenceId,
  type RazorpayPayment,
} from "../lib/razorpay/client";
import { caseIdFromNotes } from "../lib/razorpay/map";
import { asRunCase, byName } from "./helpers";
import { SEED_CASES } from "../lib/seed/cases";
import type { Play } from "../lib/types";

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

const LINK_PLAY: Play = {
  id: "payment_link",
  label: "Payment link",
  channel: "whatsapp",
  reason: "Send a single-use payment link.",
};

type LinkPost = { reference_id: string; notes: { recoverai_case_id?: string } };

function nv1050() {
  const seed = asRunCase(byName(SEED_CASES, "Rohan Iyer"));
  seed.id = "NV-1050";
  return seed;
}

function installRazorpayEnv() {
  const prevId = process.env.RAZORPAY_KEY_ID;
  const prevSecret = process.env.RAZORPAY_KEY_SECRET;
  process.env.RAZORPAY_KEY_ID = "rzp_test_mock";
  process.env.RAZORPAY_KEY_SECRET = "secret_mock";
  return () => {
    if (prevId === undefined) delete process.env.RAZORPAY_KEY_ID;
    else process.env.RAZORPAY_KEY_ID = prevId;
    if (prevSecret === undefined) delete process.env.RAZORPAY_KEY_SECRET;
    else process.env.RAZORPAY_KEY_SECRET = prevSecret;
  };
}

function parseLinkPost(init?: RequestInit): LinkPost {
  return JSON.parse(String(init?.body ?? "{}")) as LinkPost;
}

function mockPaymentLinkCreate(opts?: {
  collideOn?: (referenceId: string, attempt: number) => boolean;
  fail?: string;
}) {
  const posts: LinkPost[] = [];
  const fetchMock = mock.method(
    globalThis,
    "fetch",
    async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = parseLinkPost(init);
      posts.push(body);
      if (opts?.fail) {
        return new Response(JSON.stringify({ error: { description: opts.fail } }), { status: 502 });
      }
      if (opts?.collideOn?.(body.reference_id, posts.length)) {
        return new Response(
          JSON.stringify({
            error: {
              description: `payment link with given reference_id: ${body.reference_id} already exists`,
            },
          }),
          { status: 400 },
        );
      }
      return new Response(
        JSON.stringify({
          id: `plink_${posts.length}`,
          short_url: `https://rzp.io/i/link${posts.length}`,
          status: "created",
          amount: 189900,
        }),
        { status: 200 },
      );
    },
  );
  return { posts, fetchMock };
}

test("new payment-link reference_id is unique and keeps case id in notes", () => {
  const first = paymentLinkReferenceId("NV-1050");
  const second = paymentLinkReferenceId("NV-1050");
  assert.notEqual(first, "NV-1050");
  assert.notEqual(second, "NV-1050");
  assert.notEqual(first, second);
  assert.ok(first.length <= 40);
  assert.ok(second.length <= 40);

  const body = paymentLinkCreateBody({
    caseId: "NV-1050",
    amountInr: 1899,
    name: "Rohan Iyer",
    description: "Nivaara recovery NV-1050",
  });
  assert.notEqual(body.reference_id, "NV-1050");
  assert.equal((body.notes as { recoverai_case_id: string }).recoverai_case_id, "NV-1050");
  assert.equal(paymentLinkNotes("NV-1050").recoverai_case_id, "NV-1050");
  assert.equal(caseIdFromNotes(paymentLinkNotes("NV-1050")), "NV-1050");
  assert.ok(
    isPaymentLinkReferenceCollision("payment link with given reference_id: NV-1050 already exists"),
  );
});

test("first payment-link creation stores the returned Razorpay URL and does not recover", async (t) => {
  const restoreEnv = installRazorpayEnv();
  const { posts, fetchMock } = mockPaymentLinkCreate();
  t.after(() => {
    fetchMock.mock.restore();
    restoreEnv();
  });

  const seed = nv1050();
  const result = await executePlay(seed, LINK_PLAY, "expired_card");
  assert.equal(result.ok, true);
  assert.equal(result.settled, false);
  assert.equal(result.provider, "razorpay");
  assert.equal(result.referenceId, "plink_1");
  assert.equal(result.paymentLinkUrl, "https://rzp.io/i/link1");
  assert.equal(posts.length, 1);
  assert.notEqual(posts[0]!.reference_id, seed.id);
  assert.equal(posts[0]!.notes.recoverai_case_id, seed.id);
});

test("second payment-link creation for the same case uses a new reference_id and URL", async (t) => {
  const restoreEnv = installRazorpayEnv();
  const { posts, fetchMock } = mockPaymentLinkCreate();
  t.after(() => {
    fetchMock.mock.restore();
    restoreEnv();
  });

  const seed = nv1050();
  seed.signals.razorpayPaymentLinkId = "plink_old";
  seed.paymentLinkUrl = "https://rzp.io/i/old";

  const first = await executePlay(seed, LINK_PLAY, "expired_card");
  const second = await executePlay(seed, LINK_PLAY, "expired_card");

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(first.settled, false);
  assert.equal(second.settled, false);
  assert.notEqual(first.paymentLinkUrl, seed.paymentLinkUrl);
  assert.notEqual(second.paymentLinkUrl, first.paymentLinkUrl);
  assert.equal(second.paymentLinkUrl, "https://rzp.io/i/link2");
  assert.equal(posts.length, 2);
  assert.notEqual(posts[0]!.reference_id, seed.id);
  assert.notEqual(posts[1]!.reference_id, seed.id);
  assert.notEqual(posts[0]!.reference_id, posts[1]!.reference_id);
  assert.equal(posts[0]!.notes.recoverai_case_id, seed.id);
  assert.equal(posts[1]!.notes.recoverai_case_id, seed.id);
});

test("reference_id collision retries with a unique id and returns the new link", async (t) => {
  const restoreEnv = installRazorpayEnv();
  const { posts, fetchMock } = mockPaymentLinkCreate({
    collideOn: (referenceId) => referenceId === "NV-1050",
  });
  t.after(() => {
    fetchMock.mock.restore();
    restoreEnv();
  });

  const link = await createPaymentLink({
    caseId: "NV-1050",
    amountInr: 1899,
    name: "Rohan Iyer",
    description: "Nivaara recovery NV-1050",
    referenceId: "NV-1050",
  });

  assert.equal(posts.length, 2);
  assert.equal(posts[0]!.reference_id, "NV-1050");
  assert.notEqual(posts[1]!.reference_id, "NV-1050");
  assert.equal(posts[1]!.notes.recoverai_case_id, "NV-1050");
  assert.equal(link.id, "plink_2");
  assert.equal(link.short_url, "https://rzp.io/i/link2");
});

test("successful new link is stored on the case for Open Razorpay payment link", async (t) => {
  const restoreEnv = installRazorpayEnv();
  const { fetchMock } = mockPaymentLinkCreate();
  t.after(() => {
    fetchMock.mock.restore();
    restoreEnv();
  });

  const processed = await processCase(nv1050(), DEFAULT_POLICY, policyNow(DEFAULT_POLICY));
  assert.equal(processed.play?.id, "payment_link");
  assert.equal(processed.execution?.ok, true);
  assert.equal(processed.execution?.settled, false);
  assert.equal(processed.execution?.paymentLinkUrl, "https://rzp.io/i/link1");
  assert.equal(processed.paymentLinkUrl, "https://rzp.io/i/link1");
  assert.equal(processed.signals.razorpayPaymentLinkId, "plink_1");
  assert.equal(processed.status, "at_risk");
  assert.equal(processed.outcome?.recoveredInr, 0);
});

test("failed creation does not record recovery or invent a payment-link URL", async (t) => {
  const restoreEnv = installRazorpayEnv();
  const { fetchMock } = mockPaymentLinkCreate({ fail: "gateway timeout" });
  t.after(() => {
    fetchMock.mock.restore();
    restoreEnv();
  });

  const before = nv1050();
  before.signals.razorpayPaymentLinkId = "plink_existing";
  before.paymentLinkUrl = "https://rzp.io/i/existing";
  const processed = await processCase(before, DEFAULT_POLICY, policyNow(DEFAULT_POLICY));
  assert.equal(processed.execution?.ok, false);
  assert.equal(processed.execution?.settled, false);
  assert.equal(processed.status, "at_risk");
  assert.equal(processed.outcome?.recoveredInr, 0);
  assert.equal(processed.paymentLinkUrl, "https://rzp.io/i/existing");
  assert.equal(processed.signals.razorpayPaymentLinkId, "plink_existing");
  assert.equal(processed.execution?.paymentLinkUrl, undefined);
});

test("capture webhook still maps to the case after a unique reference_id link", async (t) => {
  const restoreEnv = installRazorpayEnv();
  const { fetchMock } = mockPaymentLinkCreate();
  t.after(() => {
    fetchMock.mock.restore();
    restoreEnv();
  });

  const processed = await processCase(nv1050(), DEFAULT_POLICY, policyNow(DEFAULT_POLICY));
  const ws = { ...emptyWorkspace(), cases: [processed], audit: [] };
  const payment: RazorpayPayment = {
    id: "pay_nv1050",
    amount: processed.amountInr * 100,
    currency: "INR",
    status: "captured",
    created_at: Math.floor(Date.now() / 1000),
    notes: { recoverai_case_id: processed.id },
  };
  const next = applyRazorpayWebhook(ws, {
    event: "payment.captured",
    payment,
    link: {
      id: "plink_other",
      short_url: processed.paymentLinkUrl,
      notes: paymentLinkNotes(processed.id),
    },
  });
  const cse = next.cases[0]!;
  assert.equal(cse.id, "NV-1050");
  assert.equal(cse.status, "recovered");
  assert.equal(cse.outcome?.recoveredInr, processed.amountInr);
  assert.equal(cse.execution?.settled, true);
});

test("duplicate capture remains idempotent after unique reference_id links", async (t) => {
  const restoreEnv = installRazorpayEnv();
  const { fetchMock } = mockPaymentLinkCreate();
  t.after(() => {
    fetchMock.mock.restore();
    restoreEnv();
  });

  const first = await processCase(nv1050(), DEFAULT_POLICY, policyNow(DEFAULT_POLICY));
  const second = await processCase(first, DEFAULT_POLICY, policyNow(DEFAULT_POLICY));
  assert.notEqual(second.paymentLinkUrl, first.paymentLinkUrl);
  assert.equal(second.status, "at_risk");
  assert.equal(second.outcome?.recoveredInr, 0);

  const ws = { ...emptyWorkspace(), cases: [second], audit: [] };
  const payment: RazorpayPayment = {
    id: "pay_dup_nv1050",
    amount: second.amountInr * 100,
    currency: "INR",
    status: "captured",
    created_at: Math.floor(Date.now() / 1000),
    notes: { recoverai_case_id: second.id },
  };
  const once = applyRazorpayWebhook(ws, { event: "payment.captured", payment, link: { id: "plink_2" } });
  const twice = applyRazorpayWebhook(once, { event: "payment.captured", payment, link: { id: "plink_2" } });
  const cse = twice.cases[0]!;
  assert.equal(cse.status, "recovered");
  assert.equal(cse.outcome?.recoveredInr, second.amountInr);
  assert.equal(cse.timeline.filter((e) => e.action === "PAYMENT_OUTCOME").length, 1);
});
