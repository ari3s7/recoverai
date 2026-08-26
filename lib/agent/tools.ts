import {
  getCaseContext,
  getCheckoutContext,
  getCustomerHistory,
  getInvoiceContext,
  getMandateContext,
  getPaymentContext,
  getPromiseContext,
  getSubscriptionContext,
} from "./context";
import { analyzeRootCause, calculateRecoveryScore } from "./score";
import { evaluatePolicy } from "../engine/policy";
import { DEFAULT_POLICY, policyNow } from "../policy/defaults";
import type { PlayId, PolicyConfig, RootCause, SeedCase } from "../types";

/**
 * Controlled read/analysis/safety helpers. Action execution stays in processCase —
 * these functions never write the store or call Razorpay.
 */
export const agentTools = {
  getCaseContext,
  getCustomerHistory,
  getPaymentContext,
  getCheckoutContext,
  getSubscriptionContext,
  getInvoiceContext,
  getPromiseContext,
  getMandateContext,
  calculateRecoveryScore,
  analyzeRootCause,
  checkGuardrails(seed: SeedCase, policy: PolicyConfig = DEFAULT_POLICY, at?: Date) {
    return evaluatePolicy(seed, policy, at ?? policyNow(policy));
  },
};

export const ACTION_TOOL_NAMES: PlayId[] = [
  "smart_retry",
  "payment_link",
  "hinglish_voice",
  "promise_to_pay",
  "human_escalate",
  "stop",
];

export function actionToolForPlay(play: PlayId): string {
  switch (play) {
    case "smart_retry":
      return "scheduleRetry";
    case "payment_link":
      return "createPaymentLink";
    case "hinglish_voice":
      return "sendRecoveryMessage";
    case "promise_to_pay":
      return "createPromiseToPay";
    case "human_escalate":
      return "escalateToHuman";
    case "stop":
      return "stopRecovery";
  }
}

export function analyzeRootCauseTool(seed: SeedCase, cause: RootCause) {
  return analyzeRootCause(getCaseContext(seed), cause);
}
