"use client";

import { useEffect, useState } from "react";
import { CAUSE_LABEL, inr, ist, LEAK_LABEL, PLAY_LABEL } from "@/lib/format";
import type { CaseActionRequest, RunCase } from "@/lib/types";
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
  const [script, setScript] = useState(cse?.play?.script ?? "");
  const [narrative, setNarrative] = useState(cse?.diagnosis?.narrative ?? "");
  const [promiseDate, setPromiseDate] = useState("");
  const [polishing, setPolishing] = useState(false);
  const [speaking, setSpeaking] = useState(false);

  useEffect(() => {
    setScript(cse?.play?.script ?? "");
    setNarrative(cse?.diagnosis?.narrative ?? "");
    setPromiseDate(cse?.outcome?.promisedDate ?? cse?.signals.promiseToPayDate ?? "");
  }, [cse]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!cse) return null;
  const open = cse;

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
            <Label>Case</Label>
            <p className="font-medium">{LEAK_LABEL[cse.leakType]}</p>
            <p className="text-xs text-muted mt-1">
              {cse.merchantSegment.toUpperCase()} · occurred {ist(cse.occurredAt)}
            </p>
          </section>

          {cse.agent ? (
            <section className="rounded-lg border border-gold/30 bg-gold/5 p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <Label>AI decision</Label>
                <span className="text-[10px] uppercase tracking-wide text-muted">{cse.agent.provider}</span>
              </div>
              <p className="font-medium text-gold">{PLAY_LABEL[cse.agent.recommendedPlay]}</p>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <span className="text-muted">Recovery probability</span>
                  <p className="tabular font-medium">{Math.round(cse.agent.recoveryProbability * 100)}%</p>
                </div>
                <div>
                  <span className="text-muted">Confidence</span>
                  <p className="tabular font-medium">{cse.agent.confidence}%</p>
                </div>
              </div>
              <p className="text-xs text-muted">
                Root cause: {CAUSE_LABEL[cse.agent.rootCause]}
              </p>
              {cse.agent.reasoning.length ? (
                <ul className="space-y-1 text-xs text-muted">
                  {cse.agent.reasoning.map((e) => (
                    <li key={e}>· {e}</li>
                  ))}
                </ul>
              ) : null}
            </section>
          ) : null}

          <section>
            <Label>Diagnosis</Label>
            <p className="font-medium">
              {cse.diagnosis?.label ?? "Not run"}
              {cse.diagnosis ? ` · ${cse.diagnosis.confidence}%` : ""}
            </p>
            <p className="text-muted mt-2 leading-relaxed">{narrative || "Run the agent to diagnose root cause."}</p>
            {cse.diagnosis?.evidence?.length ? (
              <ul className="mt-3 space-y-1 text-xs text-muted">
                {cse.diagnosis.evidence.map((e) => (
                  <li key={e}>· {e}</li>
                ))}
              </ul>
            ) : null}
          </section>

          <section>
            <Label>Policy gate</Label>
            <p className={cse.policy?.allowed === false ? "text-danger" : "text-ok"}>
              {cse.policy?.action === "proceed" ? "Approved" : cse.policy?.action ?? "—"}
              {cse.policy?.ruleId ? ` · ${cse.policy.ruleId}` : ""}
            </p>
            <p className="text-muted mt-1">{cse.policy?.reason ?? "Stopping rules have not been evaluated yet."}</p>
            {cse.agent && cse.play && cse.agent.recommendedPlay !== cse.play.id ? (
              <p className="text-xs text-muted mt-2">
                AI suggested {PLAY_LABEL[cse.agent.recommendedPlay]}; policy/merge executed{" "}
                {PLAY_LABEL[cse.play.id]}.
              </p>
            ) : null}
          </section>

          <section>
            <Label>Executed action</Label>
            <p className="font-medium">{cse.play ? PLAY_LABEL[cse.play.id] : "—"}</p>
            <p className="text-muted mt-1">{cse.play?.reason}</p>
            {cse.execution ? (
              <p className="mt-2 font-mono text-[11px] text-gold-dim">
                {cse.execution.provider} · {cse.execution.referenceId}
                <br />
                {cse.execution.message}
              </p>
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
          </section>

          {cse.outcome ? (
            <section className="rounded-lg border border-line p-3">
              <Label>Payment outcome</Label>
              <p className="font-medium">
                {cse.outcome.recoveredInr > 0
                  ? `Recovered ${inr(cse.outcome.recoveredInr)}`
                  : cse.outcome.status === "promised"
                    ? `Promised ${inr(cse.outcome.promisedInr)}`
                    : cse.outcome.status.replace("_", " ")}
              </p>
              <p className="text-muted mt-1 text-xs">{cse.outcome.note}</p>
              {cse.execution?.settled === false && cse.execution.paymentLinkUrl ? (
                <p className="text-[10px] text-muted mt-2">Action executed; settlement pending.</p>
              ) : null}
              {cse.execution?.settled ? (
                <p className="text-[10px] text-ok mt-2">
                  {cse.execution.provider === "razorpay"
                    ? "Razorpay verified capture"
                    : "Sandbox simulation settled (demo — not live money)"}
                </p>
              ) : null}
            </section>
          ) : null}

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
              Run case
            </OpButton>
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
                    {ist(ev.ts)} · {ev.actor} · {ev.action}
                    {ev.moneyDeltaInr ? ` · +${inr(ev.moneyDeltaInr)}` : ""}
                  </div>
                  <div className="text-xs text-foreground/80">{ev.reason}</div>
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
