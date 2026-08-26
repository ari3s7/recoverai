# RecoverAI

Operator desk for **AI Revenue Recovery** (Track 03). It takes a batch of leaked revenue — failed payments, abandoned checkouts, lapsed subscriptions, overdue invoices — diagnoses each case, applies stopping rules, executes a bounded play, and reports **rupees recovered**.

No Postgres. No Stripe. No Twilio. State lives in `data/store.json`. Payments and voice run through a replayable **sandbox adapter** so the desk is always demoable and still structured like production.

## Run

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Optional LLM polish (diagnosis copy and Hinglish scripts). The batch never waits on it:

```bash
cp .env.example .env.local
# set OPENAI_API_KEY or GEMINI_API_KEY
```

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

Detect → Diagnose → Policy gate → Select play → Sandbox execute → Outcome → Audit.

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

Next.js (App Router) · TypeScript · Tailwind · file-backed workspace · optional OpenAI/Gemini · Web Speech API for Hinglish playback in Chrome.
