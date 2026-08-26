# RecoverAI

Operator desk for **AI Revenue Recovery** (Track 03). It takes a batch of leaked revenue — failed payments, abandoned checkouts, lapsed subscriptions, overdue invoices — diagnoses each case, applies stopping rules, executes a bounded play, and reports **rupees recovered**.

No Postgres. No Twilio. State lives in `data/store.json`. Payments default to a sandbox adapter; with Razorpay test keys the desk issues **real payment links** and settles on capture webhooks.

## Run

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Optional LLM polish (diagnosis copy and Hinglish scripts). The batch never waits on it:

```bash
cp .env.example .env.local
# optional: OPENAI_API_KEY or GEMINI_API_KEY
# optional: RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, RAZORPAY_WEBHOOK_SECRET
```

## Razorpay

Without keys the desk stays in sandbox (hackathon demo still works).

With **test keys** (`rzp_test_…`):

1. Put keys in `.env.local` and restart.
2. Command center → **Sync failed payments** (`POST /api/razorpay/sync`).
3. Run a recovery batch. Payment-link / retry / voice plays call Razorpay Payment Links. The case stays at-risk until paid.
4. Dashboard → Webhooks → `http://<host>/api/webhooks/razorpay`  
   Events: `payment.failed`, `payment.captured`, `payment_link.paid`.  
   Secret → `RAZORPAY_WEBHOOK_SECRET`.

Razorpay will not re-debit a failed card. RecoverAI issues a **new** INR payment link instead. Capture marks the case recovered and adds the rupee delta to the audit.

## 90-second demo

1. **Command** — exposure across 48 Nivaara cases.
2. Click **Run recovery batch**. Watch detect → diagnose → policy → act. Recovered INR counts up. Audit streams on the right.
3. Open a **Stopped** case (`NV-1048` Kabir Singh — complaint, or `NV-1054` Farhan Ali — DNC). Policy fired. No outbound.
4. Open a **Hinglish voice** recovery (`NV-1060` Nikhil Bansal, price shock). Click **Speak**.
5. Open **Queue** for high-AOV / 60+ DPD B2B that must not be auto-called (`NV-1079` Neel Logistics).
6. Open **Promises** for dated holds (`NV-1083` Saffron Traders).
7. Open **Audit** — recovered vs stopped vs escalated. Export JSON/CSV.

Say on camera: *it does not just flag leakage. It recovers a measured number across a batch, under stopping rules, with an audit trail.*

## Product surface

| Route | What it is |
| --- | --- |
| `/` | Command center, batch runner, ingest |
| `/queue` | Human escalation queue |
| `/promises` | Promise-to-pay tracker |
| `/audit` | Filterable audit trail + export |
| `/policy` | Editable stopping rules |

## Pipeline

Detect → Diagnose → Policy gate → Select play → Execute (sandbox or Razorpay) → Outcome → Audit.

**Stops:** DNC, complaint, legal, fraud/chargeback, contact cap (default 3 / 7 days).

**Holds:** quiet hours IST (21:00–09:00), active promise-to-pay.

**Escalates:** amount ≥ ₹25,000 or B2B DPD ≥ 60. No auto voice.

**Plays:** smart retry, payment link, Hinglish voice, promise-to-pay, human escalate, stop.

## APIs

- `GET /api/workspace` — full desk snapshot
- `POST /api/batch/run` — SSE case-by-case run
- `POST /api/cases/:id/actions` — `run` \| `stop` \| `escalate` \| `mark_recovered` \| `capture_promise` \| `release_hold`
- `PUT /api/policy` — stopping rules
- `POST /api/ingest/webhook` — live leak event
- `POST /api/ingest/csv` — bulk import (`public/sample-cases.csv`)
- `POST /api/razorpay/sync` — pull failed Razorpay payments
- `POST /api/webhooks/razorpay` — signed `payment.failed` / `payment.captured` / `payment_link.paid`
- `POST /api/workspace/reset` — restore the 48-case seed
- `GET /api/health`

Webhook example:

```json
{
  "type": "payment.failed",
  "amountInr": 2199,
  "customer": { "name": "Ira Sen", "city": "Pune" },
  "declineCode": "INSUFFICIENT_FUNDS"
}
```

## Stack

Next.js (App Router) · TypeScript · Tailwind · file-backed workspace · optional Razorpay · optional OpenAI/Gemini · Web Speech API for Hinglish playback in Chrome.
