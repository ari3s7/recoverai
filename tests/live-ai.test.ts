import assert from "node:assert/strict";
import { test } from "node:test";
import {
  liveAiStatusFromFailure,
  liveAiUserMessage,
  logLiveAiDiagnostic,
} from "../lib/agent/liveAi";
import { DEFAULT_GEMINI_MODEL, geminiGenerateUrl, geminiModel } from "../lib/llm";
import { friendlyActionError } from "../components/ui-copy";
import { buildAiVsHeuristic } from "../lib/engine/aiVsHeuristic";
import { SEED_CASES } from "../lib/seed/cases";
import { asRunCase } from "./helpers";

test("HTTP and timeout failures are not labeled invalid JSON", () => {
  assert.equal(liveAiStatusFromFailure("http_error"), "unavailable");
  assert.equal(liveAiStatusFromFailure("timeout"), "timeout");
  assert.equal(liveAiStatusFromFailure("empty_response"), "invalid_response");
  assert.equal(liveAiStatusFromFailure("json_extract_failed"), "invalid_response");
  assert.equal(liveAiStatusFromFailure("invalid_json"), "invalid_response");
  assert.equal(liveAiStatusFromFailure("invalid_rootCause"), "rejected");
  assert.equal(liveAiStatusFromFailure("invalid_recommendedPlay"), "rejected");
  assert.match(liveAiUserMessage("unavailable", { reason: "http_error", provider: "openai", httpStatus: 429 }), /unavailable/i);
  assert.match(liveAiUserMessage("unavailable", { reason: "http_error", provider: "openai", httpStatus: 429 }), /429/);
  assert.doesNotMatch(liveAiUserMessage("unavailable", { reason: "http_error", provider: "openai", httpStatus: 429 }), /invalid response/i);
  assert.match(liveAiUserMessage("timeout", { reason: "timeout", provider: "gemini" }), /timeout/i);
  assert.match(liveAiUserMessage("rejected", { reason: "invalid_rootCause", provider: "gemini" }), /rejected by validator/i);
});

test("Live AI UI copy distinguishes 503, timeout, invalid response, rejected, and heuristic fallback", () => {
  const unavailable503 = liveAiUserMessage("unavailable", {
    reason: "http_error",
    provider: "gemini",
    httpStatus: 503,
  });
  assert.match(unavailable503, /provider returned 503/i);
  assert.match(unavailable503, /heuristic fallback/i);
  assert.doesNotMatch(unavailable503, /invalid response/i);
  assert.doesNotMatch(unavailable503, /timeout/i);
  assert.doesNotMatch(unavailable503, /rejected by validator/i);

  const timeout = liveAiUserMessage("timeout", { reason: "timeout", provider: "gemini" });
  assert.match(timeout, /AI timeout/i);
  assert.doesNotMatch(timeout, /invalid response/i);
  assert.doesNotMatch(timeout, /503/);

  const invalid = liveAiUserMessage("invalid_response", { reason: "invalid_json", provider: "gemini" });
  assert.match(invalid, /AI invalid response/i);
  assert.doesNotMatch(invalid, /rejected by validator/i);
  assert.doesNotMatch(invalid, /503/);

  const rejected = liveAiUserMessage("rejected", { reason: "invalid_recommendedPlay", provider: "gemini" });
  assert.match(rejected, /AI rejected by validator/i);
  assert.doesNotMatch(rejected, /invalid response/i);

  const fallback = liveAiUserMessage("fallback");
  assert.equal(fallback, "Heuristic fallback available.");
  assert.doesNotMatch(fallback, /invalid response/i);
  assert.doesNotMatch(fallback, /503/);
});

test("comparison UI uses precise fallback copy for OpenAI HTTP failure", () => {
  const cse = asRunCase(SEED_CASES[0]!);
  cse.liveAiStatus = "unavailable";
  cse.liveAiFailure = { reason: "http_error", provider: "openai", httpStatus: 429 };
  const view = buildAiVsHeuristic(cse);
  assert.equal(view.liveAi, null);
  assert.equal(view.liveAiStatus, "unavailable");
  assert.match(view.agreementLabel, /AI unavailable/i);
  assert.match(view.agreementLabel, /heuristic fallback/i);
  assert.doesNotMatch(view.agreementLabel, /invalid response/i);
});

test("comparison UI distinguishes Gemini HTTP 503 from invalid response", () => {
  const cse = asRunCase(SEED_CASES[0]!);
  cse.liveAiStatus = "unavailable";
  cse.liveAiFailure = { reason: "http_error", provider: "gemini", httpStatus: 503 };
  const view = buildAiVsHeuristic(cse);
  assert.equal(view.liveAi, null);
  assert.match(view.agreementLabel, /provider returned 503/i);
  assert.match(view.agreementLabel, /heuristic fallback/i);
  assert.doesNotMatch(view.agreementLabel, /invalid response/i);
  assert.doesNotMatch(view.agreementLabel, /timeout/i);
});

test("Gemini model default is not the retired 2.0 flash id", () => {
  assert.notEqual(DEFAULT_GEMINI_MODEL, "gemini-2.0-flash");
  assert.match(DEFAULT_GEMINI_MODEL, /gemini-3/);
});

test("Gemini generateContent URL matches the configured model", () => {
  assert.equal(geminiModel(), process.env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL);
  assert.equal(
    geminiGenerateUrl(),
    `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel()}:generateContent`,
  );
});

test("friendlyActionError preserves provider 503 vs timeout vs invalid vs rejected", () => {
  assert.match(friendlyActionError("AI unavailable (gemini HTTP 503) — heuristic fallback available."), /provider returned 503/i);
  assert.doesNotMatch(friendlyActionError("AI unavailable (gemini HTTP 503) — heuristic fallback available."), /invalid response/i);
  assert.match(friendlyActionError("AI timeout (gemini). No action was executed."), /AI timeout/i);
  assert.match(friendlyActionError("AI invalid response. Heuristic fallback available."), /AI invalid response/i);
  assert.match(friendlyActionError("AI response rejected by validator. No unsafe action was executed."), /rejected by validator/i);
});

test("diagnostic logger emits only safe fields", () => {
  const lines: string[] = [];
  const original = console.info;
  console.info = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };
  try {
    logLiveAiDiagnostic({
      provider: "gemini",
      model: "gemini-3.6-flash",
      reason: "http_error",
      httpStatus: 503,
      apiErrorCode: "UNAVAILABLE",
      apiErrorMessage: "The model is overloaded. Please try again later.",
      durationMs: 412,
      openaiAttempted: true,
      openaiHttpStatus: 429,
      geminiAttempted: true,
      geminiHttpStatus: 503,
      geminiKeyPresent: true,
      openaiKeyPresent: true,
      fallbackReason: "openai_http_error_429_then_gemini_http_503",
      accepted: false,
    });
  } finally {
    console.info = original;
  }
  assert.equal(lines.length, 1);
  const blob = lines[0]!;
  assert.match(blob, /\[recoverai:live-ai\]/);
  assert.match(blob, /gemini-3.6-flash/);
  assert.match(blob, /UNAVAILABLE/);
  assert.match(blob, /"httpStatus":503/);
  assert.match(blob, /"openaiAttempted":true/);
  assert.match(blob, /"openaiHttpStatus":429/);
  assert.match(blob, /overloaded/);
  assert.equal(blob.includes("sk-"), false);
  assert.equal(blob.includes("AIza"), false);
  assert.equal(blob.includes("groundTruth"), false);
  assert.equal(blob.includes("latentOutcome"), false);
  assert.equal(blob.includes("email"), false);
  assert.equal(blob.includes("webhook"), false);
});
