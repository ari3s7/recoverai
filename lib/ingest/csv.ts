import { nextCaseId, uid } from "../ids";
import type { Flag, Language, LeakType, RunCase } from "../types";
import { FLAGS, LEAK_TYPES } from "../types";

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      out.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur.trim());
  return out;
}

function isLeak(s: string): s is LeakType {
  return (LEAK_TYPES as string[]).includes(s);
}

function isFlag(s: string): s is Flag {
  return (FLAGS as string[]).includes(s);
}

export function parseCasesCsv(text: string, existingIds: string[]): { cases: RunCase[]; errors: string[] } {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) return { cases: [], errors: ["CSV needs a header and at least one row."] };
  const header = splitCsvLine(lines[0]).map((h) => h.toLowerCase());
  const idx = (name: string) => header.indexOf(name);
  const errors: string[] = [];
  const cases: RunCase[] = [];
  let ids = [...existingIds];

  for (let r = 1; r < lines.length; r++) {
    const cols = splitCsvLine(lines[r]);
    const get = (name: string) => {
      const i = idx(name);
      return i >= 0 ? cols[i] ?? "" : "";
    };
    const leak = get("leaktype") || get("leak_type") || "payment_failure";
    if (!isLeak(leak)) {
      errors.push(`Row ${r + 1}: unknown leakType "${leak}"`);
      continue;
    }
    const amount = Number(get("amountinr") || get("amount") || get("amount_inr"));
    if (!Number.isFinite(amount) || amount <= 0) {
      errors.push(`Row ${r + 1}: invalid amount`);
      continue;
    }
    const name = get("name") || get("customer") || `Imported ${r}`;
    const id = get("id") && !ids.includes(get("id")) ? get("id") : nextCaseId(ids);
    ids.push(id);
    const flags = (get("flags") || "")
      .split("|")
      .map((f) => f.trim())
      .filter(isFlag);
    const language = (get("language") || "hinglish") as Language;
    const now = new Date().toISOString();
    const draft: RunCase = {
      id,
      customer: {
        name,
        city: get("city") || "Mumbai",
        language: ["hinglish", "hindi", "english"].includes(language) ? language : "hinglish",
        phoneMasked: get("phone") || "+91 98•• ••000",
        channelPref: "whatsapp",
        company: get("company") || undefined,
      },
      leakType: leak,
      amountInr: Math.round(amount),
      occurredAt: get("occurredat") || now,
      merchantSegment: get("segment") === "b2b" ? "b2b" : "d2c",
      signals: {
        declineCode: get("declinecode") || undefined,
        dropReason: undefined,
        retryCount: Number(get("retrycount") || 0) || 0,
        contactsLast7Days: Number(get("contacts") || 0) || 0,
        daysPastDue: get("dpd") ? Number(get("dpd")) : undefined,
        invoiceNo: get("invoiceno") || undefined,
        flags,
      },
      status: "at_risk",
      timeline: [
        {
          id: uid("evt"),
          ts: now,
          caseId: id,
          actor: "ingest",
          action: "csv.import",
          reason: `Imported ${name} · ${leak}`,
        },
      ],
      updatedAt: now,
    };
    cases.push(draft);
  }
  return { cases, errors };
}

export type WebhookPayload = {
  type?: string;
  amountInr?: number;
  amount?: number;
  customer?: { name?: string; city?: string; language?: Language; company?: string };
  declineCode?: string;
  leakType?: LeakType;
  invoiceNo?: string;
  daysPastDue?: number;
  flags?: Flag[];
};

export function caseFromWebhook(payload: WebhookPayload, existingIds: string[]): RunCase {
  const now = new Date().toISOString();
  const type = payload.type ?? "";
  let leak: LeakType = payload.leakType ?? "payment_failure";
  if (type.includes("checkout")) leak = "abandoned_checkout";
  if (type.includes("subscription")) leak = "failed_subscription";
  if (type.includes("mandate")) leak = "mandate_failure";
  if (type.includes("invoice")) leak = "overdue_invoice";
  const amount = Math.round(payload.amountInr ?? payload.amount ?? 0);
  if (!amount) throw new Error("amountInr is required");
  const id = nextCaseId(existingIds);
  const name = payload.customer?.name ?? "Unknown customer";
  return {
    id,
    customer: {
      name,
      city: payload.customer?.city ?? "Mumbai",
      language: payload.customer?.language ?? "hinglish",
      phoneMasked: "+91 98•• ••000",
      channelPref: "whatsapp",
      company: payload.customer?.company,
    },
    leakType: leak,
    amountInr: amount,
    occurredAt: now,
    merchantSegment: leak === "overdue_invoice" ? "b2b" : "d2c",
    signals: {
      declineCode: payload.declineCode,
      invoiceNo: payload.invoiceNo,
      daysPastDue: payload.daysPastDue,
      retryCount: 0,
      contactsLast7Days: 0,
      flags: payload.flags ?? [],
    },
    status: "at_risk",
    timeline: [
      {
        id: uid("evt"),
        ts: now,
        caseId: id,
        actor: "ingest",
        action: "webhook",
        reason: `Ingested ${type || leak} for ${name}`,
      },
    ],
    updatedAt: now,
  };
}
