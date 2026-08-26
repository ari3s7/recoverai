"use client";

import { useEffect, useState } from "react";
import { CAUSE_LABEL, inr, ist, LEAK_LABEL, PLAY_LABEL } from "@/lib/format";
import { describeMandateSequence, isMandateCase } from "@/lib/engine/mandate";
import { DEFAULT_POLICY } from "@/lib/policy/defaults";
import type { CaseActionRequest, RunCase } from "@/lib/types";
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
  onClose,
  onAction,
}: {
  cse: RunCase | null;
  llmConfigured: boolean;
  busy?: boolean;
  onClose: () => void;
  onAction: (id: string, action: CaseActionRequest) => Promise<void>;
}) {
  const [script, setScript] = useState("");
  const [narrative, setNarrative] = useState("");
  const [promiseDate, setPromiseDate] = useState("");
  const [polishing, setPolishing] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [syncedKey, setSyncedKey] = useState("");

  const syncKey = cse ? `${cse.id}:${cse.updatedAt}` : "";
  if (cse && syncKey !== syncedKey) {
    setSyncedKey(syncKey);
    setScript(cse.play?.script ?? "");
    setNarrative(cse.diagnosis?.narrative ?? "");
    setPromiseDate(cse.outcome?.promisedDate ?? cse.signals.promiseToPayDate ?? "");
  } else if (!cse && syncedKey) {
    setSyncedKey("");
    setScript("");
    setNarrative("");
    setPromiseDate("");
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
  const mandate = isMandateCase(cse)
    ? describeMandateSequence(cse, DEFAULT_POLICY, new Date(DEFAULT_POLICY.sandboxClockIso))
    : null;

  async function polish() {
    setPolishing(true);
    try {
      const res = await fetch("/api/enrich", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ caseId: open.id }),
      });
      const data = (await res.json()) as { narrative?: string; script?: string };
      if (data.narrative) setNarrative(data.narrative);
      if (data.script) setScript(data.script);
    } finally {
      setPolishing(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <button className="flex-1 bg-black/50" aria-label="Close inspector" onClick={onClose} />
      <aside className="w-full max-w-[440px] h-full bg-panel border-l border-line overflow-y-auto">
        <div className="p-5 border-b border-line flex items-start justify-between gap-3">
          <div>
            <div className="font-mono text-xs text-gold-dim">{cse.id}</div>
            <h2 className="text-lg font-semibold mt-1">
              {cse.customer.company ?? cse.customer.name}
            </h2>
            <p className="text-xs text-muted mt-1">
              {cse.customer.company ? `${cse.customer.name} · ` : ""}
              {cse.customer.city} · {cse.customer.language} · {cse.customer.phoneMasked}
            </p>
          </div>
          <button onClick={onClose} className="text-muted hover:text-foreground text-sm">
            Close
          </button>
        </div>

        <div className="p-5 space-y-5 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-2xl tabular text-gold">{inr(cse.amountInr)}</span>
            <StatusPill status={cse.status} />
          </div>

          <section className="rounded-lg border border-line bg-background/40 p-3">
            <Label>Customer</Label>
            <p className="font-medium">{LEAK_LABEL[cse.leakType]}</p>
            <p className="text-xs text-muted mt-1">
              {cse.merchantSegment.toUpperCase()} · occurred {ist(cse.occurredAt)}
            </p>
            {cse.diagnosis ? (
              <p className="text-xs text-muted mt-2 leading-relaxed">
                {cse.diagnosis.label}
                {narrative ? ` · ${narrative}` : ""}
              </p>
            ) : null}
          </section>

          <section className="rounded-lg border border-line p-3 space-y-1">
            <Label>Customer context</Label>
            <p className="text-xs">
              {cse.signals.successfulPayments ?? "—"}/{cse.signals.lifetimePayments ?? "—"} payments succeeded
              {typeof cse.signals.avgPaymentInr === "number" ? ` · avg ${inr(cse.signals.avgPaymentInr)}` : ""}
              {typeof cse.signals.avgPaymentDelayDays === "number"
                ? ` · avg delay ${cse.signals.avgPaymentDelayDays}d`
                : ""}
            </p>
            <p className="text-xs text-muted">
              Prior recoveries {cse.signals.priorRecoveries ?? 0}
              {cse.signals.subscriptionAgeMonths
                ? ` · sub age ${cse.signals.subscriptionAgeMonths} mo`
                : ""}
              {cse.signals.previousAbandonments
                ? ` · ${cse.signals.previousAbandonments} prior abandonments`
                : ""}
              {cse.signals.previousPromises ? ` · ${cse.signals.previousPromises} prior promises` : ""}
              {typeof cse.signals.promiseFulfillmentRate === "number"
                ? ` · PTP fulfill ${Math.round(cse.signals.promiseFulfillmentRate * 100)}%`
                : ""}
            </p>
            <p className="text-xs text-muted">
              Contacts last 7d: {cse.signals.contactsLast7Days}
              {cse.signals.retryCount ? ` · ${cse.signals.retryCount} retries` : ""}
              {cse.signals.mandateRetryCount ? ` · mandate retry ${cse.signals.mandateRetryCount}` : ""}
              {cse.signals.lastContactAt ? ` · last ${ist(cse.signals.lastContactAt)}` : ""}
            </p>
          </section>

          {mandate ? (
            <section className="rounded-lg border border-line p-3 space-y-1">
              <Label>Mandate sequencer</Label>
              <p className="font-medium">
                Attempt {mandate.attempt}/{mandate.maxAttempts} · {mandate.currentState} · next{" "}
                {PLAY_LABEL[mandate.nextEligiblePlay]}
              </p>
              <p className="text-xs text-muted">{mandate.reason}</p>
              <p className="text-[10px] text-muted">
                {mandate.lastAction} · outcome {mandate.outcome}
              </p>
              {mandate.windowExpired ? <p className="text-xs text-danger">Window expired — stop.</p> : null}
              {mandate.cooldownActive ? <p className="text-xs text-muted">Cooldown active.</p> : null}
            </section>
          ) : null}

          {cse.agent ? (
            <section className="rounded-lg border border-gold/30 bg-gold/5 p-3 space-y-2">
              <Label>AI recommendation</Label>
              <p className="font-medium text-gold">{PLAY_LABEL[cse.agent.recommendedPlay]}</p>
              <p className="tabular text-sm">
                {Math.round((cse.agent.aiPredictedRecoveryProbability ?? cse.agent.recoveryProbability) * 100)}%
                predicted recovery
                <span className="text-muted"> · {cse.agent.confidence}% confidence</span>
              </p>
              <p className="text-xs text-muted">Root cause: {CAUSE_LABEL[cse.agent.rootCause]}</p>
              {cse.agent.reasoning.length ? (
                <ul className="space-y-1 text-xs text-muted">
                  {cse.agent.reasoning.map((e) => (
                    <li key={e}>✓ {e}</li>
                  ))}
                </ul>
              ) : null}
            </section>
          ) : null}

          <section>
            <Label>Policy</Label>
            <p className={cse.policy?.allowed === false || cse.policy?.action !== "proceed" ? "text-danger" : "text-ok"}>
              {cse.policy?.action === "proceed"
                ? "APPROVED"
                : (cse.policy?.action ?? "—").toUpperCase()}
              {cse.policy?.ruleId ? ` · ${cse.policy.ruleId}` : ""}
            </p>
            <p className="text-muted mt-1">{cse.policy?.reason ?? "Stopping rules have not been evaluated yet."}</p>
          </section>

          <section>
            <Label>Execution</Label>
            {cse.executionStatus === "executed" ? (
              <>
                <p className="font-medium text-ok">
                  {cse.play?.id === "payment_link" || cse.execution?.paymentLinkUrl
                    ? "Payment Link created"
                    : cse.play
                      ? `${PLAY_LABEL[cse.play.id]} executed`
                      : "EXECUTED"}
                </p>
                <p className="text-muted mt-1">{cse.execution?.message}</p>
              </>
            ) : (
              <>
                <p className="font-medium text-danger">NOT EXECUTED</p>
                <p className="text-muted mt-1">
                  {cse.policy?.reason ?? cse.execution?.message ?? "Not yet run."}
                </p>
              </>
            )}
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
          </section>

          <section className="rounded-lg border border-line p-3 space-y-1">
            <Label>Outcome</Label>
            <p className="font-medium">
              {cse.outcome?.recoveredInr
                ? cse.execution?.provider === "razorpay"
                  ? "Payment captured"
                  : "Recovered"
                : cse.outcome
                  ? cse.outcome.status === "promised"
                    ? `Promised ${inr(cse.outcome.promisedInr)}`
                    : cse.outcome.status.replace("_", " ")
                  : "—"}
            </p>
            {cse.outcome?.note ? <p className="text-muted text-xs">{cse.outcome.note}</p> : null}
          </section>

          <section className="rounded-lg border border-gold/30 bg-gold/5 p-3">
            <Label>Recovered</Label>
            <p className="text-2xl tabular text-gold font-semibold">{inr(cse.outcome?.recoveredInr ?? 0)}</p>
          </section>

          {script ? (
            <section>
              <div className="flex items-center justify-between">
                <Label>Hinglish script</Label>
                <button
                  className="text-xs text-gold hover:underline"
                  onClick={() => {
                    setSpeaking(true);
                    speakHinglish(script);
                    setTimeout(() => setSpeaking(false), 800);
                  }}
                >
                  {speaking ? "Speaking…" : "Speak"}
                </button>
              </div>
              <p className="text-muted leading-relaxed mt-1">{script}</p>
            </section>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <OpButton disabled={busy} onClick={() => onAction(cse.id, { type: "run" })}>
              Run recovery policy
            </OpButton>
            {llmConfigured ? (
              <OpButton
                disabled={busy}
                onClick={() => onAction(cse.id, { type: "live_ai" })}
              >
                Live AI agent
              </OpButton>
            ) : null}
            {cse.customer.language !== "english" ? (
              <OpButton
                disabled={busy}
                onClick={() =>
                  onAction(cse.id, {
                    type: "live_ai",
                    utterance: "Bhai payment nahi ho raha, link bhej do.",
                  })
                }
              >
                Hinglish “link bhej do”
              </OpButton>
            ) : null}
            {llmConfigured ? (
              <OpButton disabled={polishing || !cse.diagnosis} onClick={polish}>
                {polishing ? "Polishing…" : "Polish copy"}
              </OpButton>
            ) : null}
            <OpButton
              disabled={busy}
              onClick={() =>
                onAction(cse.id, { type: "mark_recovered", note: "Operator confirmed payment received." })
              }
            >
              Mark recovered
            </OpButton>
            <OpButton
              disabled={busy}
              onClick={() => onAction(cse.id, { type: "stop", reason: "Operator stopped outbound." })}
            >
              Stop
            </OpButton>
            <OpButton
              disabled={busy}
              onClick={() => onAction(cse.id, { type: "escalate", reason: "Operator pulled to human queue." })}
            >
              Escalate
            </OpButton>
            <OpButton disabled={busy} onClick={() => onAction(cse.id, { type: "release_hold" })}>
              Release hold
            </OpButton>
          </div>

          <div className="flex gap-2 items-end">
            <label className="flex-1 text-[11px] uppercase tracking-wide text-muted">
              Promise date
              <input
                type="date"
                value={promiseDate}
                onChange={(e) => setPromiseDate(e.target.value)}
                className="mt-1 w-full bg-background border border-line rounded px-2 py-1.5 text-foreground text-sm"
              />
            </label>
            <OpButton
              disabled={busy || !promiseDate}
              onClick={() =>
                onAction(cse.id, {
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
          </section>

          {cse.diagnosis ? (
            <p className="text-[11px] text-muted">Root cause code: {CAUSE_LABEL[cse.diagnosis.rootCause]}</p>
          ) : null}
        </div>
      </aside>
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
