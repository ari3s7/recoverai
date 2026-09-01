"use client";

import { useEffect, useState } from "react";
import { getCustomerHistory } from "@/lib/agent/context";
import { CHANNEL_LABEL, isChannelRecommendationOnly } from "@/lib/engine/channel";
import { buildRecoveryJourney, type JourneyStatus, type JourneyStep } from "@/lib/engine/journey";
import { describeMandateSequence, isMandateCase } from "@/lib/engine/mandate";
import { formatPlannedWhen, planNextAction } from "@/lib/engine/nextAction";
import { explainPolicyDecision } from "@/lib/engine/policyExplain";
import { describePromiseLifecycle } from "@/lib/engine/promise";
import { CAUSE_LABEL, inr, ist, LEAK_LABEL, PLAY_LABEL } from "@/lib/format";
import { DEFAULT_POLICY, policyNow } from "@/lib/policy/defaults";
import type { CaseActionRequest, PolicyConfig, RunCase } from "@/lib/types";
import { auditHeadline } from "./audit-copy";
import { StatusPill } from "./status-pill";

function speakHinglish(text: string) {
  const synth = window.speechSynthesis;
  synth.cancel();
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = "hi-IN";
  utter.rate = 0.92;
  const voices = synth.getVoices();
  const hi =
    voices.find((v) => v.lang.toLowerCase().startsWith("hi")) ??
    voices.find((v) => v.lang.toLowerCase().includes("in"));
  if (hi) utter.voice = hi;
  synth.speak(utter);
}

export function CaseDrawer({
  cse,
  llmConfigured,
  busy,
  policy = DEFAULT_POLICY,
  onClose,
  onAction,
}: {
  cse: RunCase | null;
  llmConfigured: boolean;
  busy?: boolean;
  policy?: PolicyConfig;
  onClose: () => void;
  onAction: (id: string, action: CaseActionRequest) => Promise<void>;
}) {
  const [script, setScript] = useState("");
  const [narrative, setNarrative] = useState("");
  const [promiseDate, setPromiseDate] = useState("");
  const [polishing, setPolishing] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [acting, setActing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [syncedKey, setSyncedKey] = useState("");

  const syncKey = cse ? `${cse.id}:${cse.updatedAt}` : "";
  if (cse && syncKey !== syncedKey) {
    setSyncedKey(syncKey);
    setScript(cse.play?.script ?? "");
    setNarrative(cse.diagnosis?.narrative ?? "");
    setPromiseDate(cse.outcome?.promisedDate ?? cse.signals.promiseToPayDate ?? "");
    setActionError(null);
  } else if (!cse && syncedKey) {
    setSyncedKey("");
    setScript("");
    setNarrative("");
    setPromiseDate("");
    setActionError(null);
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!cse) return null;
  const open = cse;
  const now = policyNow(policy);
  const mandate = isMandateCase(cse) ? describeMandateSequence(cse, policy, now) : null;
  const journey = buildRecoveryJourney(cse);
  const policyExplain = explainPolicyDecision(cse);
  const next = planNextAction(cse, policy, now);
  const ptp = describePromiseLifecycle(cse, now);
  const history = getCustomerHistory(cse);
  const recovered = cse.outcome?.recoveredInr ?? 0;
  const predicted = cse.agent
    ? Math.round((cse.agent.aiPredictedRecoveryProbability ?? cse.agent.recoveryProbability) * 100)
    : null;
  const alternatives = (cse.agent?.comparedPlays ?? [])
    .filter((p) => p.play !== cse.agent?.recommendedPlay)
    .slice(0, 3);
  const rootCause = cse.diagnosis?.rootCause ?? cse.agent?.rootCause;
  const locked = Boolean(busy || acting);
  const policyTone =
    policyExplain.headline === "APPROVED"
      ? "border-ok/40 text-ok"
      : policyExplain.headline === "UNEVALUATED"
        ? "border-line text-muted"
        : "border-danger/50 text-danger";

  async function runAction(action: CaseActionRequest) {
    setActing(true);
    setActionError(null);
    try {
      await onAction(open.id, action);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setActing(false);
    }
  }

  async function polish() {
    setPolishing(true);
    setActionError(null);
    try {
      const res = await fetch("/api/enrich", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ caseId: open.id }),
      });
      const data = (await res.json()) as { narrative?: string; script?: string; error?: string };
      if (!res.ok) {
        setActionError(data.error ?? "Polish failed");
        return;
      }
      if (data.narrative) setNarrative(data.narrative);
      if (data.script) setScript(data.script);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Polish failed");
    } finally {
      setPolishing(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <button className="flex-1 bg-black/50" aria-label="Close inspector" onClick={onClose} />
      <aside className="w-full max-w-[480px] h-full bg-panel border-l border-line overflow-y-auto">
        <div className="p-5 border-b border-line flex items-start justify-between gap-3">
          <div>
            <div className="font-mono text-xs text-gold-dim">{cse.id}</div>
            <h2 className="text-lg font-semibold mt-1">{cse.customer.company ?? cse.customer.name}</h2>
            <p className="text-xs text-muted mt-1">
              {cse.customer.company ? `${cse.customer.name} · ` : ""}
              {cse.customer.city} · {cse.customer.language} · {cse.customer.phoneMasked}
            </p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <StatusPill status={cse.status} />
            <button onClick={onClose} className="text-muted hover:text-foreground text-sm">
              Close
            </button>
          </div>
        </div>

        <div className="p-5 space-y-4 text-sm">
          {actionError ? (
            <div className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
              {actionError}
            </div>
          ) : null}

          <section className="rounded-lg border border-line bg-background/40 p-3 space-y-3">
            <div>
              <Label>Amount at risk</Label>
              <p className="text-2xl tabular text-gold font-semibold">{inr(cse.amountInr)}</p>
              <p className="text-[10px] text-muted">
                {LEAK_LABEL[cse.leakType]} · {cse.merchantSegment.toUpperCase()} · {ist(cse.occurredAt)}
              </p>
            </div>
            <div>
              <Label>Root cause</Label>
              <p className="font-medium">
                {rootCause ? CAUSE_LABEL[rootCause] : "Not diagnosed yet. Run recovery policy."}
              </p>
            </div>
            <div>
              <Label>AI recommendation</Label>
              <p className="font-medium">
                {cse.agent
                  ? PLAY_LABEL[cse.agent.recommendedPlay]
                  : "No recommendation yet. Run recovery policy."}
                {cse.agent?.recommendedChannel ? (
                  <span className="text-muted font-normal">
                    {" "}
                    · {CHANNEL_LABEL[cse.agent.recommendedChannel]}
                  </span>
                ) : null}
              </p>
              {cse.agent?.recommendedChannel && isChannelRecommendationOnly(cse.agent.recommendedChannel) ? (
                <p className="text-[10px] text-muted mt-1">
                  Channel is a recommendation only. RecoverAI does not send WhatsApp, SMS, voice, or email.
                </p>
              ) : null}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Recovery probability</Label>
                <p className="text-xl tabular text-gold">{predicted !== null ? `${predicted}%` : "—"}</p>
              </div>
              <div>
                <Label>Confidence</Label>
                <p className="text-xl tabular">{cse.agent ? `${cse.agent.confidence}%` : "—"}</p>
              </div>
            </div>
            <div className={`rounded-md border px-3 py-2 ${policyTone}`}>
              <Label>Policy decision</Label>
              <p className="text-lg font-semibold tracking-wide">{policyExplain.headline}</p>
              <p className="text-xs mt-1 text-foreground/80">Reason: {policyExplain.reason}</p>
              {policyExplain.aiRecommendation ? (
                <p className="text-xs mt-1">AI recommendation: {policyExplain.aiRecommendation}</p>
              ) : null}
              {policyExplain.override ? (
                <p className="text-xs mt-1">
                  Policy override: <span className="text-gold">{policyExplain.override}</span>
                </p>
              ) : null}
              <p className="text-[10px] text-muted mt-1">Policy is the final authority over the AI.</p>
            </div>
            <div>
              <Label>Execution status</Label>
              {cse.executionStatus === "executed" && cse.play && cse.play.id !== "stop" && cse.play.id !== "human_escalate" ? (
                <p className="font-medium text-ok">
                  {cse.play.id === "payment_link" || cse.execution?.paymentLinkUrl
                    ? "Payment Link created"
                    : `${PLAY_LABEL[cse.play.id]} executed`}
                </p>
              ) : cse.executionStatus ? (
                <p className="font-medium text-danger">NOT EXECUTED · {cse.executionStatus.toUpperCase()}</p>
              ) : (
                <p className="text-muted">Not yet run.</p>
              )}
              {cse.execution?.message ? (
                <p className="text-xs text-muted mt-1">{cse.execution.message}</p>
              ) : null}
              {cse.paymentLinkUrl || cse.execution?.paymentLinkUrl ? (
                <p className="mt-2">
                  <a
                    href={cse.paymentLinkUrl ?? cse.execution?.paymentLinkUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-gold hover:underline"
                  >
                    Open Razorpay payment link
                  </a>
                  <span className="block text-[10px] text-muted mt-1">
                    Payment link issued ≠ revenue recovered until capture webhook.
                  </span>
                </p>
              ) : null}
            </div>
            <div className="rounded-md border border-gold/30 bg-gold/5 px-3 py-2">
              <Label>Verified recovered</Label>
              <p className="text-2xl tabular text-gold font-semibold">{inr(recovered)}</p>
              <p className="text-[10px] text-muted mt-1">
                Counted only after capture, sandbox settlement, or operator confirmation.
              </p>
            </div>
          </section>

          <section>
            <Label>Recovery journey</Label>
            <ol className="mt-2 space-y-0">
              {journey.map((step, i) => (
                <JourneyRow key={step.id} step={step} last={i === journey.length - 1} />
              ))}
            </ol>
          </section>

          <section className="rounded-lg border border-line p-3">
            <Label>Customer 360</Label>
            <div className="grid grid-cols-2 gap-x-3 gap-y-2 mt-1">
              <Stat k="Lifetime payments" v={String(history.lifetimePayments)} />
              <Stat k="Successful" v={String(history.successfulPayments)} />
              <Stat k="Failed" v={String(history.failedPayments)} />
              <Stat k="Avg payment" v={inr(history.avgPaymentInr)} />
              <Stat k="Prior recoveries" v={String(history.priorRecoveries)} />
              <Stat k="Retries" v={String(history.retryCount)} />
              <Stat k="Contacts / 7d" v={String(history.contactsLast7Days)} />
              <Stat k="This case" v={LEAK_LABEL[cse.leakType]} />
            </div>
          </section>

          <section className="rounded-lg border border-line p-3 space-y-2">
            <Label>AI evidence</Label>
            {cse.agent?.reasoning.length ? (
              <ul className="space-y-1 text-xs">
                {cse.agent.reasoning.map((e) => (
                  <li key={e}>✓ {e}</li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-muted">No evidence yet. Run recovery policy to generate a grounded recommendation.</p>
            )}
            {alternatives.length ? (
              <div>
                <div className="text-[10px] uppercase tracking-wide text-muted mb-1">Alternatives</div>
                <ul className="text-xs text-muted space-y-0.5">
                  {alternatives.map((alt) => (
                    <li key={alt.play}>
                      {PLAY_LABEL[alt.play]} — {Math.round(alt.estimatedRecovery * 100)}%
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {narrative ? <p className="text-xs text-muted leading-relaxed">{narrative}</p> : null}
          </section>

          {next ? (
            <section className="rounded-lg border border-line p-3 space-y-1">
              <Label>Next action</Label>
              <p className="font-medium">{next.at ? formatPlannedWhen(next.at, now) : next.label}</p>
              {next.at ? <p className="text-xs text-muted">{next.label} · planned, not scheduled</p> : null}
              <p className="text-xs text-muted">Reason: {next.reason}</p>
            </section>
          ) : (
            <section className="rounded-lg border border-line p-3">
              <Label>Next action</Label>
              <p className="text-xs text-muted">
                {recovered > 0 ? "Recovery complete. No further outbound." : "No wait. Run recovery policy when ready."}
              </p>
            </section>
          )}

          {ptp.state !== "none" ? (
            <section className="rounded-lg border border-line p-3 space-y-1">
              <Label>Promise-to-pay</Label>
              <p className="font-medium">
                {ptp.state === "promised"
                  ? "PROMISED"
                  : ptp.state === "due"
                    ? "PAYMENT DUE"
                    : ptp.state === "fulfilled"
                      ? "FULFILLED"
                      : "BROKEN"}
              </p>
              {ptp.promisedDate ? <p className="text-xs text-muted">Due {ptp.promisedDate}</p> : null}
              {ptp.state === "fulfilled" ? (
                <p className="text-xs text-ok">Recovered {inr(ptp.recoveredInr)}</p>
              ) : null}
              {ptp.eligibleForRerun ? (
                <p className="text-xs text-muted">
                  Hold released. Re-run AI recommendation → policy → action. Same-date duplicates are ignored.
                </p>
              ) : null}
            </section>
          ) : null}

          {mandate ? (
            <section className="rounded-lg border border-line p-3 space-y-1">
              <Label>Mandate sequencer</Label>
              <p className="font-medium">
                Attempt {mandate.attempt}/{mandate.maxAttempts} · {mandate.currentState} · next{" "}
                {PLAY_LABEL[mandate.nextEligiblePlay]}
              </p>
              <p className="text-xs text-muted">{mandate.reason}</p>
            </section>
          ) : null}

          {script ? (
            <section>
              <div className="flex items-center justify-between">
                <Label>Hinglish script</Label>
                <button
                  className="text-xs text-gold hover:underline disabled:opacity-40"
                  disabled={locked}
                  onClick={() => {
                    setSpeaking(true);
                    speakHinglish(script);
                    setTimeout(() => setSpeaking(false), 800);
                  }}
                >
                  {speaking ? "Speaking…" : "Speak"}
                </button>
              </div>
              <p className="text-muted leading-relaxed mt-1 text-xs">{script}</p>
            </section>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <OpButton disabled={locked} onClick={() => runAction({ type: "run" })}>
              Run recovery policy
            </OpButton>
            {llmConfigured ? (
              <OpButton disabled={locked} onClick={() => runAction({ type: "live_ai" })}>
                Live AI agent
              </OpButton>
            ) : null}
            {cse.customer.language !== "english" ? (
              <OpButton
                disabled={locked}
                onClick={() =>
                  runAction({
                    type: "live_ai",
                    utterance: "Bhai payment nahi ho raha, link bhej do.",
                  })
                }
              >
                Hinglish “link bhej do”
              </OpButton>
            ) : null}
            {llmConfigured ? (
              <OpButton disabled={polishing || locked || !cse.diagnosis} onClick={polish}>
                {polishing ? "Polishing…" : "Polish copy"}
              </OpButton>
            ) : null}
            <OpButton
              disabled={locked || recovered > 0}
              onClick={() => runAction({ type: "mark_recovered", note: "Operator confirmed payment received." })}
            >
              Mark recovered
            </OpButton>
            <OpButton disabled={locked} onClick={() => runAction({ type: "stop", reason: "Operator stopped outbound." })}>
              Stop
            </OpButton>
            <OpButton
              disabled={locked}
              onClick={() => runAction({ type: "escalate", reason: "Operator pulled to human queue." })}
            >
              Escalate
            </OpButton>
            <OpButton disabled={locked} onClick={() => runAction({ type: "release_hold" })}>
              Release hold
            </OpButton>
          </div>

          <div className="flex gap-2 items-end">
            <label className="flex-1 text-[11px] uppercase tracking-wide text-muted">
              Promise date
              <input
                type="date"
                value={promiseDate}
                disabled={locked}
                onChange={(e) => setPromiseDate(e.target.value)}
                className="mt-1 w-full bg-background border border-line rounded px-2 py-1.5 text-foreground text-sm disabled:opacity-40"
              />
            </label>
            <OpButton
              disabled={locked || !promiseDate}
              onClick={() =>
                runAction({
                  type: "capture_promise",
                  date: promiseDate,
                  note: `Promise-to-pay ${promiseDate}`,
                })
              }
            >
              Capture PTP
            </OpButton>
          </div>

          <section>
            <Label>Timeline</Label>
            {cse.timeline.length ? (
              <ol className="mt-2 space-y-2">
                {[...cse.timeline].reverse().map((ev) => (
                  <li key={ev.id} className="border-l border-line pl-3">
                    <div className="font-mono text-[10px] text-muted">
                      {ist(ev.ts)} · {auditHeadline(ev.actor, ev.action)}
                      {ev.moneyDeltaInr ? ` · +${inr(ev.moneyDeltaInr)}` : ""}
                    </div>
                    <div className="text-xs text-foreground/80 whitespace-pre-wrap">{ev.reason}</div>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-xs text-muted mt-1">No events yet.</p>
            )}
          </section>
        </div>
      </aside>
    </div>
  );
}

function JourneyRow({ step, last }: { step: JourneyStep; last: boolean }) {
  const tone: Record<JourneyStatus, string> = {
    done: "border-gold text-gold",
    current: "border-gold/60 text-foreground",
    pending: "border-line text-muted",
    blocked: "border-danger text-danger",
    skipped: "border-line text-muted",
  };
  return (
    <li className="flex gap-3">
      <div className="flex flex-col items-center">
        <span className={`mt-0.5 h-2.5 w-2.5 rounded-full border ${tone[step.status]}`} />
        {last ? null : <span className="w-px flex-1 bg-line min-h-[18px]" />}
      </div>
      <div className="pb-3">
        <div className="text-[11px] uppercase tracking-wide text-muted">
          {step.title}
          {step.timestamp ? ` · ${ist(step.timestamp)}` : ""} · {step.actor}
        </div>
        <div className="text-xs font-medium">{step.decision}</div>
        {step.reason ? <div className="text-[11px] text-muted">{step.reason}</div> : null}
      </div>
    </li>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-muted">{k}</div>
      <div className="text-xs tabular">{v}</div>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <div className="text-[11px] uppercase tracking-wide text-muted mb-1">{children}</div>;
}

function OpButton({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      className="rounded-md border border-line px-2.5 py-1.5 text-xs hover:border-gold/50 hover:text-gold disabled:opacity-40"
    >
      {children}
    </button>
  );
}
