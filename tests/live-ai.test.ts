import assert from "node:assert/strict";
import { test } from "node:test";
import {
  liveAiStatusFromFailure,
  liveAiUserMessage,
  logLiveAiDiagnostic,
} from "../lib/agent/liveAi";
import { DEFAULT_GEMINI_MODEL } from "../lib/llm";
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

test("Gemini model default is not the retired 2.0 flash id", () => {
  assert.notEqual(DEFAULT_GEMINI_MODEL, "gemini-2.0-flash");
  assert.match(DEFAULT_GEMINI_MODEL, /gemini-3/);
});

test("diagnostic logger emits only safe fields", () => {
  const lines: string[] = [];
  const original = console.info;
  console.info = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };
  try {
    logLiveAiDiagnostic({
      provider: "openai",
      reason: "http_error",
      httpStatus: 429,
      apiErrorCode: "insufficient_quota",
      accepted: false,
    });
  } finally {
    console.info = original;
  }
  assert.equal(lines.length, 1);
  const blob = lines[0]!;
  assert.match(blob, /\[recoverai:live-ai\]/);
  assert.match(blob, /insufficient_quota/);
  assert.equal(blob.includes("sk-"), false);
  assert.equal(blob.includes("groundTruth"), false);
  assert.equal(blob.includes("latentOutcome"), false);
  assert.equal(blob.includes("email"), false);
});
