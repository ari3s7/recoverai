import type { LiveAiFailure, LiveAiFailureReason, LiveAiStatus } from "../types";

const LOG_PREFIX = "[recoverai:live-ai]";

export function valueKind(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

export function fieldNamesOf(json: Record<string, unknown> | null | undefined): string[] {
  return json ? Object.keys(json).slice(0, 20) : [];
}

export function valueKindsOf(json: Record<string, unknown> | null | undefined): Record<string, string> {
  if (!json) return {};
  return Object.fromEntries(Object.entries(json).slice(0, 20).map(([k, v]) => [k, valueKind(v)]));
}

export function isTimeoutError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return err.name === "TimeoutError" || err.name === "AbortError";
}

export function liveAiStatusFromFailure(reason: LiveAiFailureReason): Exclude<LiveAiStatus, "not_run" | "used"> {
  if (reason === "http_error" || reason === "no_provider") return "unavailable";
  if (reason === "timeout") return "timeout";
  if (
    reason === "invalid_rootCause" ||
    reason === "invalid_recommendedPlay" ||
    reason === "invalid_recoveryProbability" ||
    reason === "invalid_confidence" ||
    reason === "invalid_reasoning"
  ) {
    return "rejected";
  }
  return "invalid_response";
}

export function liveAiUserMessage(status: LiveAiStatus, failure?: LiveAiFailure): string {
  const provider = failure?.provider ? `${failure.provider}` : "AI";
  switch (status) {
    case "unavailable":
      return failure?.httpStatus
        ? `AI unavailable (${provider} HTTP ${failure.httpStatus}) — heuristic fallback available.`
        : `AI unavailable — heuristic fallback available.`;
    case "timeout":
      return `AI timeout (${provider}). No action was executed.`;
    case "invalid_response":
      return "AI response rejected by validator. No unsafe action was executed.";
    case "rejected":
      return "AI response rejected by validator. No unsafe action was executed.";
    case "fallback":
      return "Heuristic fallback available.";
    default:
      return "";
  }
}

const SAFE_REASONS = new Set<LiveAiFailureReason>([
  "http_error",
  "timeout",
  "empty_response",
  "json_extract_failed",
  "invalid_json",
  "invalid_rootCause",
  "invalid_recommendedPlay",
  "invalid_recoveryProbability",
  "invalid_confidence",
  "invalid_reasoning",
  "no_provider",
]);

/** Server-side diagnostic. Never logs keys, PII, ground truth, or model text. */
export function logLiveAiDiagnostic(entry: {
  provider: "openai" | "gemini";
  reason?: LiveAiFailureReason;
  httpStatus?: number;
  apiErrorCode?: string;
  fieldNames?: string[];
  valueKinds?: Record<string, string>;
  accepted?: boolean;
}): void {
  const payload: Record<string, unknown> = {
    provider: entry.provider,
    accepted: Boolean(entry.accepted),
  };
  if (entry.reason && SAFE_REASONS.has(entry.reason)) payload.reason = entry.reason;
  if (typeof entry.httpStatus === "number") payload.httpStatus = entry.httpStatus;
  if (entry.apiErrorCode) payload.apiErrorCode = String(entry.apiErrorCode).slice(0, 80);
  if (entry.fieldNames) payload.fieldNames = entry.fieldNames;
  if (entry.valueKinds) payload.valueKinds = entry.valueKinds;
  console.info(LOG_PREFIX, JSON.stringify(payload));
}
