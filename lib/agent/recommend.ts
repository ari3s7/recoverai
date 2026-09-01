import { CAUSE_LABEL, PLAY_LABEL } from "../format";
import { baselineRecommendPlay } from "../engine/baseline";
import { recommendChannel } from "../engine/channel";
import { diagnose } from "../engine/diagnose";
import { isMandateCase, nextMandateStep } from "../engine/mandate";
import { llmConfigured, openaiModel, geminiGenerateUrl } from "../llm";
import { DEFAULT_POLICY, policyNow } from "../policy/defaults";
import type {
  AgentRecommendation,
  CaseContext,
  Diagnosis,
  LiveAiFailure,
  PlayEstimate,
  PlayId,
  PolicyConfig,
  RootCause,
  SeedCase,
} from "../types";
import { gatherCaseContext } from "./context";
import { interpretCustomerIntent } from "./intent";
import {
  fieldNamesOf,
  isTimeoutError,
  logLiveAiDiagnostic,
  valueKindsOf,
} from "./liveAi";
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

const ALLOWED_PLAYS: PlayId[] = [
  "smart_retry",
  "payment_link",
  "hinglish_voice",
  "promise_to_pay",
  "human_escalate",
  "stop",
];

const LIVE_AI_TIMEOUT_MS = 20_000;

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
  ];
  if (dx.rootCause === "expired_card") reasoning.push("Current card is expired");
  reasoning.push(
    runnerUp
      ? `${PLAY_LABEL[chosen]} estimated ${Math.round(score * 100)}% vs ${PLAY_LABEL[runnerUp.play]} ${Math.round(runnerUp.estimatedRecovery * 100)}%`
      : `Best-fit play ${PLAY_LABEL[chosen]} at ${Math.round(score * 100)}% estimated recovery`,
  );
  if (intent) {
    reasoning.unshift(intent.reply);
  }
  if (ctx.mandateContext) reasoning.push(`Mandate sequencer: ${ctx.mandateContext}`);
  if (h.contactsLast7Days) reasoning.push(`${h.contactsLast7Days} contacts in the last 7 days`);
  if (h.priorRecoveries) reasoning.push(`${h.priorRecoveries} prior recoveries on this customer`);

  return {
    rootCause: dx.rootCause,
    recoveryProbability: score,
    aiPredictedRecoveryProbability: score,
    recommendedPlay: chosen,
    confidence,
    reasoning: reasoning.slice(0, 6),
    comparedPlays: comps,
    recommendedChannel: recommendChannel(seed, chosen),
    provider: "heuristic",
    baselinePlay: baselineRecommendPlay(seed, dx),
  };
}

export type ExtractJsonResult =
  | { ok: true; json: Record<string, unknown> }
  | { ok: false; reason: "empty_response" | "json_extract_failed" | "invalid_json" };

/** Strip fences and parse a JSON object. Does not log or return raw PII-bearing text. */
export function extractJsonObject(text: string): ExtractJsonResult {
  const trimmed = text.trim();
  if (!trimmed) return { ok: false, reason: "empty_response" };
  const unfenced = trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  try {
    const parsed = JSON.parse(unfenced) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return { ok: true, json: parsed as Record<string, unknown> };
    }
  } catch {
    /* balanced object below */
  }
  const start = unfenced.indexOf("{");
  if (start < 0) return { ok: false, reason: "json_extract_failed" };
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < unfenced.length; i++) {
    const ch = unfenced[i]!;
    if (inString) {
      if (escape) escape = false;
      else if (ch === "\\") escape = true;
      else if (ch === "\"") inString = false;
      continue;
    }
    if (ch === "\"") {
      inString = true;
      continue;
    }
    if (ch === "{") depth += 1;
    if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        try {
          const parsed = JSON.parse(unfenced.slice(start, i + 1)) as unknown;
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            return { ok: true, json: parsed as Record<string, unknown> };
          }
          return { ok: false, reason: "invalid_json" };
        } catch {
          return { ok: false, reason: "invalid_json" };
        }
      }
    }
  }
  return { ok: false, reason: "json_extract_failed" };
}

const FORBIDDEN_EVIDENCE = /groundTruth|latentOutcome|already recovered|money was recovered/i;

/** Drop invented/hidden-truth claims. Fall back to observable heuristic evidence. */
export function groundReasoning(lines: string[], fallback: string[]): string[] {
  const cleaned = lines.map(String).filter((line) => line.trim() && !FORBIDDEN_EVIDENCE.test(line));
  return (cleaned.length ? cleaned : fallback).slice(0, 6);
}

function slugify(raw: string): string {
  return raw.trim().toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

/** Map model labels like "Payment Link" onto the play enum. Unknown values stay invalid. */
export function normalizePlayId(raw: unknown): PlayId | null {
  if (typeof raw !== "string") return null;
  const slug = slugify(raw);
  if (isValidPlayId(slug)) return slug;
  const lower = raw.trim().toLowerCase();
  for (const [id, label] of Object.entries(PLAY_LABEL) as Array<[PlayId, string]>) {
    if (label.toLowerCase() === lower) return id;
  }
  return null;
}

/** Map model labels like "Insufficient funds" onto the root-cause enum. */
export function normalizeRootCause(raw: unknown): RootCause | null {
  if (typeof raw !== "string") return null;
  const slug = slugify(raw);
  if (ROOT_CAUSES.includes(slug as RootCause)) return slug as RootCause;
  const lower = raw.trim().toLowerCase();
  for (const [id, label] of Object.entries(CAUSE_LABEL) as Array<[RootCause, string]>) {
    if (label.toLowerCase() === lower) return id;
  }
  return null;
}

type ProviderAttempt = {
  rec: AgentRecommendation | null;
  failure: LiveAiFailure;
};

const RECOMMENDATION_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    rootCause: { type: "string", enum: ROOT_CAUSES },
    recoveryProbability: { type: "number" },
    recommendedPlay: { type: "string", enum: ALLOWED_PLAYS },
    confidence: { type: "number" },
    reasoning: { type: "array", items: { type: "string" } },
  },
  required: ["rootCause", "recoveryProbability", "recommendedPlay", "confidence", "reasoning"],
};

/** Live AI request body. Must not include ranking scores, heuristic plays, or eval secrets. */
export function buildLiveAiPayload(ctx: CaseContext, dx: Diagnosis, utterance?: string) {
  return {
    context: {
      caseId: ctx.caseId,
      leakType: ctx.leakType,
      amountInr: ctx.amountInr,
      segment: ctx.segment,
      customer: {
        language: ctx.customer.language,
        channelPref: ctx.customer.channelPref,
        city: ctx.customer.city,
      },
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
    allowedRootCauses: ROOT_CAUSES,
    allowedPlays: ALLOWED_PLAYS,
    instruction:
      "You are making an independent recommendation from the observable case context. Do not infer or reproduce a recommendation from any external scoring system. Choose the play that best fits the customer situation. Your recoveryProbability must be your own estimate, not copied from another score. Return JSON only with keys rootCause, recoveryProbability (0-1), recommendedPlay, confidence (0-1), reasoning (array of ≤5 observable evidence strings). Use the allowed enum slugs. Policy will validate — you only recommend. Never claim money was recovered.",
  };
}

const SYSTEM =
  "You are RecoverAI, a revenue recovery agent for Indian D2C and B2B merchants. Diagnose root cause and recommend ONE bounded play using the allowed enum slugs. You are making an independent recommendation from the observable case context. Do not infer or reproduce a recommendation from any external scoring system. Choose the play that best fits the customer situation. Your recoveryProbability must be your own estimate, not copied from another score. Never claim money was recovered. Never mention hidden ground truth.";

async function completeAttempt(
  provider: "openai" | "gemini",
  text: string,
  seed: SeedCase,
  dx: Diagnosis,
  ranked: Array<{ play: PlayId; score: number }>,
): Promise<ProviderAttempt> {
  const extracted = extractJsonObject(text);
  if (!extracted.ok) {
    const failure: LiveAiFailure = { reason: extracted.reason, provider };
    logLiveAiDiagnostic({ provider, reason: extracted.reason, accepted: false });
    return { rec: null, failure };
  }
  const parsed = parseLlmRecommendationResult(extracted.json, seed, dx, ranked, provider);
  if (!parsed.ok) {
    const failure: LiveAiFailure = {
      reason: parsed.reason,
      provider,
      fieldNames: fieldNamesOf(extracted.json),
    };
    logLiveAiDiagnostic({
      provider,
      reason: parsed.reason,
      fieldNames: failure.fieldNames,
      valueKinds: valueKindsOf(extracted.json),
      accepted: false,
    });
    return { rec: null, failure };
  }
  logLiveAiDiagnostic({
    provider,
    fieldNames: fieldNamesOf(extracted.json),
    accepted: true,
  });
  return { rec: parsed.rec, failure: { reason: "invalid_json", provider } };
}

async function tryOpenAI(
  payload: ReturnType<typeof buildLiveAiPayload>,
  seed: SeedCase,
  dx: Diagnosis,
  ranked: Array<{ play: PlayId; score: number }>,
): Promise<ProviderAttempt | null> {
  if (!process.env.OPENAI_API_KEY) return null;
  const run = async (responseFormat: unknown) =>
    fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: openaiModel(),
        temperature: 0.2,
        response_format: responseFormat,
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: JSON.stringify(payload) },
        ],
      }),
      signal: AbortSignal.timeout(LIVE_AI_TIMEOUT_MS),
    });

  try {
    const jsonSchemaFormat = {
      type: "json_schema",
      json_schema: {
        name: "recovery_recommendation",
        strict: true,
        schema: RECOMMENDATION_JSON_SCHEMA,
      },
    };
    let res = await run(jsonSchemaFormat);
    if (res.status === 400) {
      res = await run({ type: "json_object" });
    }
    if (!res.ok) {
      let apiErrorCode: string | undefined;
      try {
        const errBody = (await res.json()) as { error?: { code?: string; type?: string } };
        apiErrorCode = errBody.error?.code ?? errBody.error?.type;
      } catch {
        /* ignore */
      }
      logLiveAiDiagnostic({ provider: "openai", reason: "http_error", httpStatus: res.status, apiErrorCode, accepted: false });
      return { rec: null, failure: { reason: "http_error", provider: "openai", httpStatus: res.status } };
    }
    const data = (await res.json()) as { choices?: { message?: { content?: string | null } }[] };
    const content = data.choices?.[0]?.message?.content ?? "";
    return completeAttempt("openai", content, seed, dx, ranked);
  } catch (err) {
    if (isTimeoutError(err)) {
      logLiveAiDiagnostic({ provider: "openai", reason: "timeout", accepted: false });
      return { rec: null, failure: { reason: "timeout", provider: "openai" } };
    }
    logLiveAiDiagnostic({ provider: "openai", reason: "http_error", accepted: false });
    return { rec: null, failure: { reason: "http_error", provider: "openai" } };
  }
}

const GEMINI_RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    rootCause: { type: "STRING" },
    recoveryProbability: { type: "NUMBER" },
    recommendedPlay: { type: "STRING" },
    confidence: { type: "NUMBER" },
    reasoning: { type: "ARRAY", items: { type: "STRING" } },
  },
  required: ["rootCause", "recoveryProbability", "recommendedPlay", "confidence", "reasoning"],
};

async function tryGemini(
  payload: ReturnType<typeof buildLiveAiPayload>,
  seed: SeedCase,
  dx: Diagnosis,
  ranked: Array<{ play: PlayId; score: number }>,
): Promise<ProviderAttempt | null> {
  if (!process.env.GEMINI_API_KEY) return null;
  try {
    const res = await fetch(geminiGenerateUrl(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": process.env.GEMINI_API_KEY,
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: `${SYSTEM}\n${JSON.stringify(payload)}` }] }],
        generationConfig: {
          temperature: 0.2,
          responseMimeType: "application/json",
          responseSchema: GEMINI_RESPONSE_SCHEMA,
        },
      }),
      signal: AbortSignal.timeout(LIVE_AI_TIMEOUT_MS),
    });
    if (!res.ok) {
      let apiErrorCode: string | undefined;
      try {
        const errBody = (await res.json()) as { error?: { status?: string; code?: number } };
        apiErrorCode = errBody.error?.status ?? (errBody.error?.code != null ? String(errBody.error.code) : undefined);
      } catch {
        /* ignore */
      }
      logLiveAiDiagnostic({ provider: "gemini", reason: "http_error", httpStatus: res.status, apiErrorCode, accepted: false });
      return { rec: null, failure: { reason: "http_error", provider: "gemini", httpStatus: res.status } };
    }
    const data = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const content = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    return completeAttempt("gemini", content, seed, dx, ranked);
  } catch (err) {
    if (isTimeoutError(err)) {
      logLiveAiDiagnostic({ provider: "gemini", reason: "timeout", accepted: false });
      return { rec: null, failure: { reason: "timeout", provider: "gemini" } };
    }
    logLiveAiDiagnostic({ provider: "gemini", reason: "http_error", accepted: false });
    return { rec: null, failure: { reason: "http_error", provider: "gemini" } };
  }
}

async function llmRecommend(
  ctx: CaseContext,
  dx: Diagnosis,
  seed: SeedCase,
  utterance?: string,
): Promise<{ rec: AgentRecommendation | null; failure: LiveAiFailure | null }> {
  const ranked = rankPlays(ctx, dx.rootCause, seed);
  const payload = buildLiveAiPayload(ctx, dx, utterance);
  const openai = await tryOpenAI(payload, seed, dx, ranked);
  if (openai?.rec) return { rec: openai.rec, failure: null };
  const gemini = await tryGemini(payload, seed, dx, ranked);
  if (gemini?.rec) return { rec: gemini.rec, failure: null };
  const failure =
    gemini?.failure ??
    openai?.failure ??
    ({ reason: "no_provider" } satisfies LiveAiFailure);
  if (!openai && !gemini) {
    logLiveAiDiagnostic({ provider: "openai", reason: "no_provider", accepted: false });
  }
  return { rec: null, failure };
}

function finiteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value.trim().replace(/%$/, ""));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** recoveryProbability must be in [0, 1]. Integer percents 2–100 are accepted. */
export function parseProbability01(value: unknown): number | null {
  const n = finiteNumber(value);
  if (n === null) return null;
  if (n >= 0 && n <= 1) return n;
  if (n > 1 && n <= 100 && Number.isInteger(n)) return n / 100;
  return null;
}

/** Confidence stored as 0–100. LLM may send 0–1 or 0–100. 0 stays 0. */
export function parseConfidencePercent(value: unknown): number | null {
  const n = finiteNumber(value);
  if (n === null) return null;
  if (n < 0 || n > 100) return null;
  if (n <= 1) return Math.round(n * 100);
  return Math.round(n);
}

export type ParseLlmResult =
  | { ok: true; rec: AgentRecommendation }
  | { ok: false; reason: LiveAiFailure["reason"] };

export function parseLlmRecommendationResult(
  json: Record<string, unknown>,
  seed: SeedCase,
  dx: Diagnosis,
  ranked: Array<{ play: PlayId; score: number }>,
  provider: "openai" | "gemini",
): ParseLlmResult {
  const rootCause = normalizeRootCause(json.rootCause);
  if (!rootCause) return { ok: false, reason: "invalid_rootCause" };
  const recommendedPlay = normalizePlayId(json.recommendedPlay);
  if (!recommendedPlay) return { ok: false, reason: "invalid_recommendedPlay" };
  const recoveryProbability = parseProbability01(json.recoveryProbability);
  if (recoveryProbability === null) return { ok: false, reason: "invalid_recoveryProbability" };
  const confidence = parseConfidencePercent(json.confidence);
  if (confidence === null) return { ok: false, reason: "invalid_confidence" };
  const reasoning = Array.isArray(json.reasoning)
    ? json.reasoning.map(String).map((line) => line.trim()).filter(Boolean).slice(0, 5)
    : typeof json.reasoning === "string" && json.reasoning.trim()
      ? [json.reasoning.trim()]
      : [];
  if (!reasoning.length) return { ok: false, reason: "invalid_reasoning" };
  return {
    ok: true,
    rec: {
      rootCause,
      recoveryProbability,
      aiPredictedRecoveryProbability: recoveryProbability,
      recommendedPlay,
      confidence,
      reasoning,
      comparedPlays: compared(ranked),
      recommendedChannel: recommendChannel(seed, recommendedPlay),
      provider,
      baselinePlay: baselineRecommendPlay(seed, dx),
    },
  };
}

export function parseLlmRecommendation(
  json: Record<string, unknown>,
  seed: SeedCase,
  dx: Diagnosis,
  ranked: Array<{ play: PlayId; score: number }>,
  provider: "openai" | "gemini",
): AgentRecommendation | null {
  const parsed = parseLlmRecommendationResult(json, seed, dx, ranked, provider);
  return parsed.ok ? parsed.rec : null;
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

export type RecoveryRecommendation = {
  context: CaseContext;
  diagnosis: Diagnosis;
  /** Recommendation sent to policy. Live LLM when valid; otherwise heuristic. */
  agent: AgentRecommendation;
  /** Deterministic heuristic from the same context. Never a second fake AI call. */
  heuristic: AgentRecommendation;
  /** Parsed live LLM recommendation, or null when unused/invalid. */
  liveAi: AgentRecommendation | null;
  liveAiFailure?: LiveAiFailure | null;
};

export async function recommendRecovery(
  seed: SeedCase,
  opts?: { forceHeuristic?: boolean; policy?: PolicyConfig; utterance?: string },
): Promise<RecoveryRecommendation> {
  const policy = opts?.policy ?? DEFAULT_POLICY;
  if (!llmConfigured() || opts?.forceHeuristic) {
    const result = recommendRecoveryHeuristic(seed, policy, opts?.utterance);
    return { ...result, heuristic: result.agent, liveAi: null, liveAiFailure: null };
  }
  const context = gatherCaseContext(seed);
  const diagnosis = diagnose(seed);
  const heuristic = heuristicRecommend(context, diagnosis, seed, policy, opts?.utterance);
  let llm: AgentRecommendation | null = null;
  let liveAiFailure: LiveAiFailure | null = null;
  try {
    const attempted = await llmRecommend(context, diagnosis, seed, opts?.utterance);
    llm = attempted.rec;
    liveAiFailure = attempted.failure;
  } catch (err) {
    liveAiFailure = {
      reason: isTimeoutError(err) ? "timeout" : "http_error",
      provider: process.env.OPENAI_API_KEY ? "openai" : "gemini",
    };
    logLiveAiDiagnostic({
      provider: liveAiFailure.provider ?? "openai",
      reason: liveAiFailure.reason,
      accepted: false,
    });
    llm = null;
  }
  if (!llm) return { context, diagnosis, agent: heuristic, heuristic, liveAi: null, liveAiFailure };
  return {
    context,
    diagnosis,
    agent: {
      ...llm,
      rootCause: diagnosis.rootCause,
      reasoning: groundReasoning(llm.reasoning, heuristic.reasoning),
      comparedPlays: llm.comparedPlays.length ? llm.comparedPlays : heuristic.comparedPlays,
    },
    heuristic,
    liveAi: llm,
    liveAiFailure: null,
  };
}
