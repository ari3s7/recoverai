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

export type AgentRecommendation = {
  rootCause: RootCause;
  recoveryProbability: number;
  recommendedPlay: PlayId;
  confidence: number;
  reasoning: string[];
  comparedPlays: PlayEstimate[];
  provider: "openai" | "gemini" | "heuristic";
  /** Naive baseline play for A/B comparison on the same case. */
  baselinePlay: PlayId;
};

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
    priorRecoveries: number;
    subscriptionAgeMonths: number;
    previousAbandonments: number;
    previousPromises: number;
    promiseFulfillmentRate: number;
    contactsLast7Days: number;
    retryCount: number;
    mandateRetryCount: number;
  };
};

export type EvaluationStrategyMetrics = {
  strategy: "baseline" | "recoverai_agent";
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
  byLeak: Record<LeakType, { exposureInr: number; recoveredInr: number; count: number }>;
};

export type EvaluationReport = {
  caseCount: number;
  baseline: EvaluationStrategyMetrics;
  agent: EvaluationStrategyMetrics;
  incrementalRecoveredInr: number;
  recoveryLiftPct: number;
  dataset: "synthetic" | "seed";
  ranAt: string;
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
  agent?: AgentRecommendation;
  policy?: PolicyVerdict;
  play?: Play;
  outcome?: Outcome;
  execution?: ExecutionResult;
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
