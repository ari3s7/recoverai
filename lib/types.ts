export type LeakType =
  | "payment_failure"
  | "abandoned_checkout"
  | "failed_subscription"
  | "overdue_invoice"
  | "mandate_failure";

export type RootCause =
  | "insufficient_funds"
  | "expired_card"
  | "bank_decline"
  | "mandate_revoked"
  | "price_shock"
  | "checkout_friction"
  | "payment_page_drop"
  | "retry_exhausted"
  | "cashflow_delay"
  | "dispute_unaware"
  | "forgotten_renewal";

export type PlayId =
  | "smart_retry"
  | "payment_link"
  | "hinglish_voice"
  | "promise_to_pay"
  | "human_escalate"
  | "stop";

export type CaseStatus =
  | "at_risk"
  | "in_flight"
  | "recovered"
  | "promised"
  | "escalated"
  | "stopped"
  | "held";

export type Flag =
  | "dnc"
  | "complaint"
  | "fraud"
  | "chargeback"
  | "quiet_hours"
  | "high_aov"
  | "legal";

export type Language = "hinglish" | "hindi" | "english";

export type ChannelPref = "whatsapp" | "voice" | "sms" | "email";

export type RecommendedChannel = ChannelPref | "payments" | "operator" | "none";

export type Customer = {
  name: string;
  city: string;
  language: Language;
  phoneMasked: string;
  channelPref: ChannelPref;
  company?: string;
  email?: string;
  contact?: string;
};

export type CaseSignals = {
  declineCode?: string;
  dropReason?: "price_shock" | "checkout_friction" | "payment_page_drop";
  subReason?:
    | "retry_exhausted"
    | "expired_card"
    | "mandate_revoked"
    | "forgotten_renewal";
  invoiceReason?: "cashflow_delay" | "dispute_unaware" | "forgotten_renewal";
  cartItems?: string[];
  invoiceNo?: string;
  daysPastDue?: number;
  retryCount: number;
  contactsLast7Days: number;
  lastContactAt?: string;
  promiseToPayDate?: string;
  razorpayPaymentId?: string;
  razorpayPaymentLinkId?: string;
  paymentSuccessRate?: number;
  lifetimePayments?: number;
  successfulPayments?: number;
  failedPayments?: number;
  avgPaymentInr?: number;
  avgPaymentDelayDays?: number;
  priorRecoveries?: number;
  subscriptionAgeMonths?: number;
  previousAbandonments?: number;
  previousPromises?: number;
  promiseFulfillmentRate?: number;
  mandateRetryCount?: number;
  lastRetryAt?: string;
  recoveryWindowDays?: number;
  flags: Flag[];
};

export type SeedCase = {
  id: string;
  customer: Customer;
  leakType: LeakType;
  amountInr: number;
  occurredAt: string;
  merchantSegment: "d2c" | "b2b";
  signals: CaseSignals;
  /**
   * Hidden simulator conversion propensity (0–1). Never shown to the AI
   * and never copied into CaseContext. Observed history is what the agent sees.
   */
  groundTruthPropensity?: number;
  /**
   * Hidden paired evaluation draw in [0, 1]. Same value is compared against
   * baseline and RecoverAI conversion probabilities. Never sent to the AI.
   */
  latentOutcomeSeed?: number;
};

export type Diagnosis = {
  rootCause: RootCause;
  label: string;
  confidence: number;
  evidence: string[];
  narrative: string;
};

export type PolicyAction = "proceed" | "escalate" | "stop" | "hold";

export type PolicyVerdict = {
  allowed: boolean;
  action: PolicyAction;
  ruleId?: string;
  reason: string;
};

export type Play = {
  id: PlayId;
  label: string;
  channel: string;
  reason: string;
  script?: string;
};

export type Outcome = {
  status: CaseStatus;
  recoveredInr: number;
  promisedInr: number;
  promisedDate?: string;
  note: string;
};

export type PlayEstimate = {
  play: PlayId;
  estimatedRecovery: number;
};

export type ExecutionStatus = "executed" | "blocked" | "held" | "queued" | "escalated";

export type AgentRecommendation = {
  rootCause: RootCause;
  /** Alias of aiPredictedRecoveryProbability (0–1). Not ground truth. */
  recoveryProbability: number;
  /** Strategy/AI predicted conversion (0–1). Never equal to hidden ground truth. */
  aiPredictedRecoveryProbability: number;
  recommendedPlay: PlayId;
  /** Display confidence 0–100. LLM JSON may send 0–1; we normalize. */
  confidence: number;
  reasoning: string[];
  comparedPlays: PlayEstimate[];
  /** Suggested communication path. Not an outbound send unless the play actually executes. */
  recommendedChannel: RecommendedChannel;
  provider: "openai" | "gemini" | "heuristic";
  /** Naive baseline play for A/B comparison on the same case. */
  baselinePlay: PlayId;
};

/** Whether processCase attempted a live LLM recommendation. */
export type LiveAiStatus = "not_run" | "used" | "fallback";

export type CaseContext = {
  caseId: string;
  leakType: LeakType;
  amountInr: number;
  segment: "d2c" | "b2b";
  customer: Customer;
  signals: CaseSignals;
  paymentContext?: string;
  checkoutContext?: string;
  subscriptionContext?: string;
  invoiceContext?: string;
  promiseContext?: string;
  mandateContext?: string;
  customerHistory: {
    paymentSuccessRate: number;
    lifetimePayments: number;
    successfulPayments: number;
    failedPayments: number;
    avgPaymentInr: number;
    avgPaymentDelayDays: number;
    priorRecoveries: number;
    subscriptionAgeMonths: number;
    previousAbandonments: number;
    previousPromises: number;
    promiseFulfillmentRate: number;
    contactsLast7Days: number;
    retryCount: number;
    mandateRetryCount: number;
    lastContactAt?: string;
  };
};

export type EvaluationStrategyMetrics = {
  strategy: "baseline" | "recoverai_policy";
  exposureInr: number;
  recoveredInr: number;
  recoveryRate: number;
  actionCount: number;
  recoveredCount: number;
  escalatedCount: number;
  stoppedCount: number;
  promisedCount: number;
  promisedFulfilledCount: number;
  actionsPerRecovery: number;
  avgPredictedProbability: number;
  byLeak: Record<LeakType, { exposureInr: number; recoveredInr: number; count: number }>;
};

export type CalibrationBucket = {
  bucket: string;
  count: number;
  avgPredicted: number;
  actualRecoveryRate: number;
};

export type EvaluationReport = {
  caseCount: number;
  baseline: EvaluationStrategyMetrics;
  policy: EvaluationStrategyMetrics;
  incrementalRecoveredInr: number;
  recoveryLiftPct: number;
  recoveryRateLiftPct: number;
  actionEfficiencyDelta: number;
  escalationDelta: number;
  dataset: "synthetic" | "seed";
  ranAt: string;
  /** Always recoverai_policy for the bulk experiment — LLM is not called. */
  decisionMode: "recoverai_policy";
  llmCalls: number;
  paired: true;
  calibration: CalibrationBucket[];
  brierScore: number;
};

export type ExecutionResult = {
  ok: boolean;
  /** True only when money actually moved (sandbox conversion or Razorpay capture). */
  settled?: boolean;
  provider: "sandbox.payments" | "sandbox.comms" | "sandbox.voice" | "policy" | "operator" | "razorpay";
  referenceId: string;
  message: string;
  paymentLinkUrl?: string;
};

export type AuditActor = "agent" | "ai" | "policy" | "human" | "ingest";

export type AuditEvent = {
  id: string;
  ts: string;
  caseId: string;
  actor: AuditActor;
  action: string;
  reason: string;
  moneyDeltaInr?: number;
};

export type RunCase = SeedCase & {
  status: CaseStatus;
  diagnosis?: Diagnosis;
  /** Recommendation that went to policy (live LLM if valid, otherwise heuristic). Not the authorized play. */
  agent?: AgentRecommendation;
  /** Deterministic heuristic snapshot from the same decision. Used for AI vs heuristic comparison. */
  heuristic?: AgentRecommendation;
  /** not_run until Live AI is attempted; fallback if the LLM was invalid and heuristic was used. */
  liveAiStatus?: LiveAiStatus;
  policy?: PolicyVerdict;
  play?: Play;
  outcome?: Outcome;
  execution?: ExecutionResult;
  executionStatus?: ExecutionStatus;
  operatorNote?: string;
  lastBatchId?: string;
  paymentLinkUrl?: string;
  timeline: AuditEvent[];
  updatedAt: string;
};

export type PolicyConfig = {
  maxContactsPer7Days: number;
  quietHoursStart: number;
  quietHoursEnd: number;
  highAovInr: number;
  b2bEscalateDpd: number;
  maxRetries: number;
  maxMandateRetries: number;
  recoveryWindowDays: number;
  mandateRetryCooldownHours: number;
  timezone: "Asia/Kolkata";
  autoExecute: boolean;
  sandboxClock: boolean;
  sandboxClockIso: string;
};

export type BatchTotals = {
  exposureInr: number;
  recoveredInr: number;
  promisedInr: number;
  stillAtRiskInr: number;
  heldInr: number;
  recoveredCount: number;
  promisedCount: number;
  stoppedCount: number;
  escalatedCount: number;
  heldCount: number;
  processedCount: number;
  recoveryRate: number;
};

export type BatchRunSummary = {
  id: string;
  startedAt: string;
  finishedAt?: string;
  caseCount: number;
  totals: BatchTotals;
};

export type Workspace = {
  version: 1;
  merchant: {
    name: string;
    desk: string;
  };
  policy: PolicyConfig;
  cases: RunCase[];
  audit: AuditEvent[];
  runs: BatchRunSummary[];
};

export type BatchStreamEvent =
  | { type: "start"; id: string; exposureInr: number; caseCount: number }
  | { type: "case"; case: RunCase; totals: BatchTotals }
  | { type: "done"; totals: BatchTotals; finishedAt: string; runId: string };

export type CaseActionRequest =
  | { type: "run" }
  | { type: "live_ai"; utterance?: string }
  | { type: "stop"; reason: string }
  | { type: "escalate"; reason: string }
  | { type: "mark_recovered"; amountInr?: number; note?: string }
  | { type: "capture_promise"; date: string; amountInr?: number; note?: string }
  | { type: "release_hold" };

export const FLAGS: Flag[] = [
  "dnc",
  "complaint",
  "fraud",
  "chargeback",
  "quiet_hours",
  "high_aov",
  "legal",
];

export const LEAK_TYPES: LeakType[] = [
  "payment_failure",
  "abandoned_checkout",
  "failed_subscription",
  "overdue_invoice",
  "mandate_failure",
];

export type RazorpayStatus = {
  configured: boolean;
  mode: "off" | "test" | "live";
  webhookConfigured: boolean;
};
