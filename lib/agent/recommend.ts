import { CAUSE_LABEL, PLAY_LABEL } from "../format";
import { baselineRecommendPlay } from "../engine/baseline";
import { diagnose } from "../engine/diagnose";
import { isMandateCase, nextMandateStep } from "../engine/mandate";
import { llmConfigured } from "../llm";
import { DEFAULT_POLICY, policyNow } from "../policy/defaults";
import type {
  AgentRecommendation,
  CaseContext,
  Diagnosis,
  PlayEstimate,
  PlayId,
  PolicyConfig,
  RootCause,
  SeedCase,
} from "../types";
import { gatherCaseContext } from "./context";
import { interpretCustomerIntent } from "./intent";
import { rankPlays } from "./score";
import { isValidPlayId } from "./validate";

const ROOT_CAUSES: RootCause[] = [
  "insufficient_funds",
  "expired_card",
  "bank_decline",
  "mandate_revoked",
  "price_shock",
  "checkout_friction",
  "payment_page_drop",
  "retry_exhausted",
  "cashflow_delay",
  "dispute_unaware",
  "forgotten_renewal",
];

function compared(ranked: Array<{ play: PlayId; score: number }>): PlayEstimate[] {
  return ranked
    .filter((r) => r.play !== "stop" && r.play !== "human_escalate")
    .slice(0, 4)
    .map((r) => ({ play: r.play, estimatedRecovery: Math.round(r.score * 100) / 100 }));
}

function heuristicRecommend(
  ctx: CaseContext,
  dx: Diagnosis,
  seed: SeedCase,
  policy = DEFAULT_POLICY,
  utterance?: string,
): AgentRecommendation {
  const ranked = rankPlays(ctx, dx.rootCause, seed);
  const actionable = ranked.filter((r) => r.play !== "stop" && r.play !== "human_escalate");
  const langOk = seed.customer.language !== "english";
  let chosen = actionable[0]?.play ?? "payment_link";

  if (isMandateCase(seed)) {
    chosen = nextMandateStep(seed, policy, policyNow(policy));
    if (chosen === "stop") chosen = "payment_link";
  } else if (dx.rootCause === "expired_card" || dx.rootCause === "mandate_revoked") {
    chosen = "payment_link";
  } else if (dx.rootCause === "cashflow_delay") {
    chosen = "promise_to_pay";
  } else if (
    langOk &&
    (dx.rootCause === "price_shock" || dx.rootCause === "payment_page_drop" || dx.rootCause === "forgotten_renewal")
  ) {
    chosen = "hinglish_voice";
  } else if (!langOk && chosen === "hinglish_voice") {
    chosen = actionable.find((r) => r.play !== "hinglish_voice")?.play ?? "payment_link";
  }

  if (seed.signals.flags.includes("high_aov") && ctx.amountInr >= 25000) {
    chosen = "human_escalate";
  }

  const intent = utterance ? interpretCustomerIntent(utterance) : null;
  if (intent && intent.play !== "stop") {
    chosen = intent.play;
  }
  if (intent?.play === "stop") chosen = "stop";

  const score =
    ranked.find((r) => r.play === chosen)?.score ??
    (chosen === "human_escalate" || chosen === "stop" ? 0 : 0.2);
  const second = actionable.find((r) => r.play !== chosen)?.score ?? 0;
  const confidence = Math.round(Math.min(96, 70 + (score - second) * 110 + dx.confidence * 0.12));
  const comps = compared(ranked);
  const runnerUp = comps.find((c) => c.play !== chosen);

  const h = ctx.customerHistory;
  const reasoning = [
    `${h.successfulPayments}/${h.lifetimePayments} previous payments succeeded`,
    `${CAUSE_LABEL[dx.rootCause]} on ₹${ctx.amountInr.toLocaleString("en-IN")}`,
    h.retryCount ? `${h.retryCount} prior automatic retries already fired` : "Current failure is isolated (no prior retries)",
    runnerUp
      ? `${PLAY_LABEL[chosen]} estimated ${Math.round(score * 100)}% vs ${PLAY_LABEL[runnerUp.play]} ${Math.round(runnerUp.estimatedRecovery * 100)}%`
      : `Best-fit play ${PLAY_LABEL[chosen]} at ${Math.round(score * 100)}% estimated recovery`,
  ];
  if (intent) {
    reasoning.unshift(intent.reply);
  }
  if (ctx.mandateContext) reasoning.push(`Mandate sequencer: ${ctx.mandateContext}`);
  if (h.contactsLast7Days) reasoning.push(`${h.contactsLast7Days} contacts in the last 7 days`);

  return {
    rootCause: dx.rootCause,
    recoveryProbability: score,
    recommendedPlay: chosen,
    confidence,
    reasoning: reasoning.slice(0, 5),
    comparedPlays: comps,
    provider: "heuristic",
    baselinePlay: baselineRecommendPlay(seed, dx),
  };
}

function extractJson(text: string): Record<string, unknown> | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function llmRecommend(
  ctx: CaseContext,
  dx: Diagnosis,
  seed: SeedCase,
  utterance?: string,
): Promise<AgentRecommendation | null> {
  const ranked = rankPlays(ctx, dx.rootCause, seed);
  const payload = {
    context: {
      caseId: ctx.caseId,
      leakType: ctx.leakType,
      amountInr: ctx.amountInr,
      segment: ctx.segment,
      customer: ctx.customer,
      paymentContext: ctx.paymentContext,
      checkoutContext: ctx.checkoutContext,
      subscriptionContext: ctx.subscriptionContext,
      invoiceContext: ctx.invoiceContext,
      mandateContext: ctx.mandateContext,
      promiseContext: ctx.promiseContext,
      customerHistory: ctx.customerHistory,
      flags: ctx.signals.flags,
    },
    customerUtterance: utterance ?? null,
    gatewayHint: { rootCause: dx.rootCause, label: dx.label },
    playScores: compared(ranked),
    allowedPlays: [
      "smart_retry",
      "payment_link",
      "hinglish_voice",
      "promise_to_pay",
      "human_escalate",
      "stop",
    ],
    instruction:
      "Compare the scored plays and pick ONE. You may disagree with the gateway hint if evidence is stronger. Return JSON only: rootCause, recoveryProbability (0-1), recommendedPlay, confidence (0-100), reasoning (max 5 concise evidence bullets). Do not include chain-of-thought. Policy will validate — you only recommend.",
  };

  const system =
    "You are RecoverAI, a revenue recovery agent for Indian D2C and B2B merchants. Choose the best bounded recovery play by comparing options. Never claim money was recovered.";

  if (process.env.OPENAI_API_KEY) {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
        temperature: 0.2,
        messages: [
          { role: "system", content: system },
          { role: "user", content: JSON.stringify(payload) },
        ],
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const json = extractJson(data.choices?.[0]?.message?.content ?? "");
    if (!json) return null;
    return parseLlmJson(json, seed, dx, ranked, "openai");
  }

  if (process.env.GEMINI_API_KEY) {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: `${system}\n${JSON.stringify(payload)}` }] }],
        }),
        signal: AbortSignal.timeout(8000),
      },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const json = extractJson(data.candidates?.[0]?.content?.parts?.[0]?.text ?? "");
    if (!json) return null;
    return parseLlmJson(json, seed, dx, ranked, "gemini");
  }

  return null;
}

function parseLlmJson(
  json: Record<string, unknown>,
  seed: SeedCase,
  dx: Diagnosis,
  ranked: Array<{ play: PlayId; score: number }>,
  provider: "openai" | "gemini",
): AgentRecommendation | null {
  const rc = String(json.rootCause ?? "");
  const play = String(json.recommendedPlay ?? "");
  if (!ROOT_CAUSES.includes(rc as RootCause) || !isValidPlayId(play)) return null;
  const reasoning = Array.isArray(json.reasoning)
    ? json.reasoning.map(String).slice(0, 5)
    : [String(json.reasoning ?? "LLM recommendation")];
  const scored = ranked.find((r) => r.play === play)?.score;
  return {
    rootCause: rc as RootCause,
    recoveryProbability: Math.min(1, Math.max(0, Number(json.recoveryProbability) || scored || 0.3)),
    recommendedPlay: play,
    confidence: Math.min(100, Math.max(0, Math.round(Number(json.confidence) || 75))),
    reasoning,
    comparedPlays: compared(ranked),
    provider,
    baselinePlay: baselineRecommendPlay(seed, dx),
  };
}

export function recommendRecoveryHeuristic(
  seed: SeedCase,
  policy: PolicyConfig = DEFAULT_POLICY,
  utterance?: string,
): {
  context: CaseContext;
  diagnosis: Diagnosis;
  agent: AgentRecommendation;
} {
  const context = gatherCaseContext(seed);
  const diagnosis = diagnose(seed);
  const agent = heuristicRecommend(context, diagnosis, seed, policy, utterance);
  return { context, diagnosis, agent };
}

export async function recommendRecovery(
  seed: SeedCase,
  opts?: { forceHeuristic?: boolean; policy?: PolicyConfig; utterance?: string },
): Promise<{
  context: CaseContext;
  diagnosis: Diagnosis;
  agent: AgentRecommendation;
}> {
  const policy = opts?.policy ?? DEFAULT_POLICY;
  if (!llmConfigured() || opts?.forceHeuristic) {
    return recommendRecoveryHeuristic(seed, policy, opts?.utterance);
  }
  const context = gatherCaseContext(seed);
  const diagnosis = diagnose(seed);
  const llm = await llmRecommend(context, diagnosis, seed, opts?.utterance);
  const agent = llm ?? heuristicRecommend(context, diagnosis, seed, policy, opts?.utterance);
  return { context, diagnosis, agent };
}
