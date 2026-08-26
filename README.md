# RecoverAI

AI-powered revenue recovery agent for Indian D2C and B2B merchants (Razorpay AI Buildathon). Merchant: **Nivaara**.

RecoverAI detects revenue at risk, builds decision-time context, recommends a bounded recovery play, applies merchant guardrails, executes **only** authorized actions, observes the real payment outcome, and measures recovered rupees.

```
DETECT → CONTEXT → AI RECOMMEND → POLICY GATE → BOUNDED ACTION → OUTCOME → AUDIT → MEASURE
```

Policy is authoritative. The AI is advisory. Razorpay (or the sandbox settlement adapter) is the source of truth for recovered money. **Issuing a Payment Link is not recovery.**

No Postgres. No Redis. No LangChain. State lives in `data/store.json`.

## Run

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

```bash
cp .env.example .env.local
# optional live AI: OPENAI_API_KEY or GEMINI_API_KEY
# optional Razorpay test keys: RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, RAZORPAY_WEBHOOK_SECRET
```

```bash
npm test
npm run lint
npm run build
```

## How decisions work

1. **Context builder** — observed payment history, leak type, retries, contacts, mandate/invoice/checkout fields. Hidden ground truth is never included.
2. **RecoverAI agent** — diagnoses root cause, scores plays, recommends one play with a predicted probability, confidence, and concise evidence.
   - **Desk batch / Evaluate page:** deterministic **RecoverAI Recovery Policy**. **LLM calls: 0.**
   - **Live AI:** per-case OpenAI or Gemini when a key is set. Invalid JSON falls back to the deterministic policy.
3. **Policy gate** — DNC, complaint, legal, fraud/chargeback, contact cap, quiet hours, active promise-to-pay, high-AOV / B2B DPD, retry and mandate caps, recovery window, `autoExecute`.
4. **Authorization** — ALLOW / HOLD / ESCALATE / STOP / queued. `executePlay()` runs **only** when authorized.
5. **Outcome** — sandbox conversion (demo) or Razorpay capture webhook (test mode).
6. **Audit** — `AI_DECISION`, `POLICY_DECISION`, `ACTION_EXECUTED` / `ACTION_BLOCKED` / `ACTION_HELD` / `ACTION_ESCALATED` / `ACTION_QUEUED`, `PAYMENT_OUTCOME`, `RECOVERY_RESULT`.

The model does **not** call Razorpay, write the store, or bypass policy. Controlled helpers in `lib/agent/tools.ts` are backend functions (context, scores, guardrails). Structured context + controlled actions — not autonomous tool calling.

## Evaluation (honest)

`/evaluation` is a **paired deterministic synthetic counterfactual**:

- Same synthetic customer/case
- Same hidden `latentOutcomeSeed`
- Baseline strategy vs RecoverAI Recovery Policy
- **LLM calls: 0**

Ground truth is synthetic and **hidden from the agent**. This is not real merchant performance.

Live LLM is a separate per-case action on the desk (`Live AI agent`).

## Razorpay

Without keys the desk stays in sandbox so the demo still runs.

With **test keys** (`rzp_test_…`):

1. Put keys in `.env.local` and restart.
2. Command → **Sync failed payments**.
3. Run recovery. Authorized payment-link / retry / voice plays issue a **new** INR Payment Link. The case stays at-risk.
4. Customer pays in Razorpay test checkout.
5. Webhook `payment.captured` / `payment_link.paid` → verified recovery. Duplicate webhooks are no-ops.

Razorpay will not re-debit a failed card. RecoverAI issues a new link instead. A failed link create does **not** mark recovered.

## Seven workflows

1. Payment degradation → root cause → retry / link / voice / PTP / escalate / stop
2. Checkout drop-off recovery
3. Failed-subscription recovery
4. B2B receivables chaser (high-AOV / DPD escalation)
5. AI-assisted bounded mandate recovery (retry cap, cooldown, window, then link)
6. Hinglish intent (“link bhej do”) → controlled payment link
7. Promise-to-pay tracker (active hold; breached date follows remaining policy)

## Demo script

1. **Command** — 48 Nivaara cases. Run recovery policy (heuristic + policy + execute).
2. **Evaluate** — paired experiment, 0 LLM calls, lift vs baseline.
3. Open a recovered payment-failure case: AI rec vs policy vs outcome vs recovered ₹.
4. Open a blocked case (Neel Logistics high-AOV B2B, or DNC Farhan Ali): AI may recommend a play; policy STOP/ESCALATE; **action not executed**.
5. Mandate cases (Bhavya Shah, Tejas Kulkarni): bounded sequencer.
6. Hinglish “link bhej do”.
7. Promises (Saffron Traders).
8. Live AI on one case if keys are set.
9. Razorpay: link issued ≠ recovered until capture.

## Product surface

| Route | What it is |
| --- | --- |
| `/` | Command center, batch runner, ingest |
| `/queue` | Human escalation queue |
| `/promises` | Promise-to-pay tracker |
| `/audit` | Filterable audit trail + export |
| `/policy` | Editable stopping rules |
| `/evaluation` | Paired synthetic benchmark |

## Guardrails

**Stops:** DNC, complaint, legal, fraud/chargeback, contact cap, expired recovery window.

**Holds:** quiet hours IST (21:00–09:00), active promise-to-pay.

**Escalates:** amount ≥ ₹25,000 or B2B DPD ≥ 60. No auto voice. No Payment Link.

**`autoExecute: false`:** recommendation is recorded; outbound is queued for an operator.

**Plays:** smart retry, payment link, Hinglish voice, promise-to-pay, human escalate, stop.

## APIs

- `GET /api/workspace`
- `POST /api/batch/run` — SSE batch (policy path, no LLM)
- `POST /api/cases/:id/actions` — `run` \| `live_ai` \| `stop` \| `escalate` \| `mark_recovered` \| `capture_promise` \| `release_hold`
- `POST /api/evaluation` — paired synthetic experiment
- `PUT /api/policy`
- `POST /api/ingest/webhook` / `POST /api/ingest/csv`
- `POST /api/razorpay/sync`
- `POST /api/webhooks/razorpay`
- `POST /api/workspace/reset`
- `GET /api/health`

## Stack

Next.js (App Router) · TypeScript · Tailwind · file-backed workspace · optional Razorpay Test Mode · optional OpenAI/Gemini · Web Speech API for Hinglish playback.
