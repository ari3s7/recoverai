"use client";

import { useEffect, useState } from "react";
import { CAUSE_LABEL, inr, ist, PLAY_LABEL } from "@/lib/format";
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
            <Label>Policy</Label>
            <p className={cse.policy?.allowed === false ? "text-danger" : "text-ok"}>
              {cse.policy?.ruleId ?? cse.policy?.action ?? "—"}
            </p>
            <p className="text-muted mt-1">{cse.policy?.reason ?? "Stopping rules have not been evaluated yet."}</p>
          </section>

          <section>
            <Label>Play</Label>
            <p className="font-medium">{cse.play ? PLAY_LABEL[cse.play.id] : "—"}</p>
            <p className="text-muted mt-1">{cse.play?.reason}</p>
            {cse.execution ? (
              <p className="mt-2 font-mono text-[11px] text-gold-dim">
                {cse.execution.provider} · {cse.execution.referenceId}
                <br />
                {cse.execution.message}
              </p>
            ) : null}
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
