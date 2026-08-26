import { CAUSE_LABEL } from "../format";
import { diagnose } from "../engine/diagnose";
import { selectPlay } from "../engine/plays";
import { llmConfigured } from "../llm";
import type {
  AgentRecommendation,
  CaseContext,
  Diagnosis,
  PlayId,
  RootCause,
  SeedCase,
} from "../types";
import { gatherCaseContext } from "./context";
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

function baselinePlayId(seed: SeedCase, dx: Diagnosis): PlayId {
  const proceed = { allowed: true, action: "proceed" as const, reason: "baseline" };
  return selectPlay(seed, dx, proceed).id;
};

function heuristicRecommend(ctx: CaseContext, dx: Diagnosis, seed: SeedCase): AgentRecommendation {
  const ranked = rankPlays(ctx, dx.rootCause).filter((r) => r.play !== "stop" && r.play !== "human_escalate");
  const langOk = seed.customer.language !== "english";
  let chosen = ranked[0]?.play ?? "payment_link";

  if (!langOk && chosen === "hinglish_voice") {
    chosen = ranked.find((r) => r.play !== "hinglish_voice")?.play ?? "payment_link";
  }
  if (seed.signals.flags.includes("high_aov") && ctx.amountInr >= 25000) {
    chosen = "human_escalate";
  }

  const score = ranked.find((r) => r.play === chosen)?.score ?? 0.2;
  const second = ranked[1]?.score ?? 0;
  const confidence = Math.round(Math.min(96, 68 + (score - second) * 120 + dx.confidence * 0.15));

  const reasoning = [
    `${Math.round(ctx.customerHistory.paymentSuccessRate * 100)}% historical payment success (${ctx.customerHistory.lifetimePayments} lifetime payments)`,
    `${CAUSE_LABEL[dx.rootCause]} on ₹${ctx.amountInr.toLocaleString("en-IN")}`,
    ctx.customerHistory.contactsLast7Days
      ? `${ctx.customerHistory.contactsLast7Days} contacts in the last 7 days`
      : "No recent outbound contacts",
    ctx.customerHistory.retryCount
      ? `${ctx.customerHistory.retryCount} prior automatic retries`
      : "Retries not exhausted",
    `Best-fit play ${chosen} scores ${Math.round(score * 100)}% estimated recovery`,
  ];

  return {
    rootCause: dx.rootCause,
    recoveryProbability: score,
    recommendedPlay: chosen,
    confidence,
    reasoning,
    provider: "heuristic",
    baselinePlay: baselinePlayId(seed, dx),
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

async function llmRecommend(ctx: CaseContext, dx: Diagnosis, seed: SeedCase): Promise<AgentRecommendation | null> {
  const payload = {
    context: ctx,
    ruleDiagnosis: { rootCause: dx.rootCause, label: dx.label, evidence: dx.evidence },
    allowedPlays: [
      "smart_retry",
      "payment_link",
      "hinglish_voice",
      "promise_to_pay",
      "human_escalate",
      "stop",
    ],
    instruction:
      "Recommend ONE recovery play for India collections. Return JSON only: rootCause, recoveryProbability (0-1), recommendedPlay, confidence (0-100), reasoning (string array, max 5 concise bullets). Do not include hidden chain-of-thought.",
  };

  const system =
    "You are RecoverAI, a revenue recovery agent for Indian D2C and B2B merchants. Recommend the best bounded play. Policy engine will validate — you only recommend.";

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
    return parseLlmJson(json, seed, dx, "openai");
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
    return parseLlmJson(json, seed, dx, "gemini");
  }

  return null;
}

function parseLlmJson(
  json: Record<string, unknown>,
  seed: SeedCase,
  dx: Diagnosis,
  provider: "openai" | "gemini",
): AgentRecommendation | null {
  const rc = String(json.rootCause ?? "");
  const play = String(json.recommendedPlay ?? "");
  if (!ROOT_CAUSES.includes(rc as RootCause) || !isValidPlayId(play)) return null;
  const reasoning = Array.isArray(json.reasoning)
    ? json.reasoning.map(String).slice(0, 5)
    : [String(json.reasoning ?? "LLM recommendation")];
  return {
    rootCause: rc as RootCause,
    recoveryProbability: Math.min(1, Math.max(0, Number(json.recoveryProbability) || 0.3)),
    recommendedPlay: play,
    confidence: Math.min(100, Math.max(0, Math.round(Number(json.confidence) || 75))),
    reasoning,
    provider,
    baselinePlay: baselinePlayId(seed, dx),
  };
}

export async function recommendRecovery(
  seed: SeedCase,
  opts?: { forceHeuristic?: boolean },
): Promise<{
  context: CaseContext;
  diagnosis: Diagnosis;
  agent: AgentRecommendation;
}> {
  const context = gatherCaseContext(seed);
  const diagnosis = diagnose(seed);

  let agent: AgentRecommendation;
  if (llmConfigured() && !opts?.forceHeuristic) {
    const llm = await llmRecommend(context, diagnosis, seed);
    agent = llm ?? heuristicRecommend(context, diagnosis, seed);
  } else {
    agent = heuristicRecommend(context, diagnosis, seed);
  }

  return { context, diagnosis: { ...diagnosis, evidence: agent.reasoning }, agent };
}

/** Baseline strategy: naive payment_link for most cases (no voice / smart timing). */
export function baselineRecommendPlay(seed: SeedCase, dx: Diagnosis): PlayId {
  if (seed.signals.flags.some((f) => ["dnc", "complaint", "legal", "fraud", "chargeback"].includes(f))) {
    return "stop";
  }
  if (seed.amountInr >= 25000 || seed.signals.flags.includes("high_aov")) {
    return "human_escalate";
  }
  if (dx.rootCause === "cashflow_delay") return "payment_link";
  return "payment_link";
}
