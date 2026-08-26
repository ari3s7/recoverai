import type {
  ChannelPref,
  Flag,
  Language,
  LeakType,
  SeedCase,
} from "../types";

type Draft = {
  name: string;
  city: string;
  leak: LeakType;
  amount: number;
  lang?: Language;
  pref?: ChannelPref;
  segment?: "d2c" | "b2b";
  company?: string;
  decline?: string;
  drop?: "price_shock" | "checkout_friction" | "payment_page_drop";
  sub?: "retry_exhausted" | "expired_card" | "mandate_revoked" | "forgotten_renewal";
  invoice?: "cashflow_delay" | "dispute_unaware" | "forgotten_renewal";
  cart?: string[];
  invoiceNo?: string;
  dpd?: number;
  retry?: number;
  contacts?: number;
  flags?: Flag[];
  ptp?: string;
  lastContact?: string;
};

const DRAFTS: Draft[] = [
  { name: "Ananya Mehta", city: "Mumbai", leak: "payment_failure", amount: 2499, decline: "INSUFFICIENT_FUNDS", pref: "whatsapp" },
  { name: "Rohan Iyer", city: "Bengaluru", leak: "payment_failure", amount: 1899, decline: "EXPIRED_CARD", lang: "english" },
  { name: "Priya Khan", city: "Hyderabad", leak: "payment_failure", amount: 4599, decline: "DO_NOT_HONOR" },
  { name: "Vikram Shah", city: "Pune", leak: "payment_failure", amount: 799, decline: "INSUFFICIENT_FUNDS", retry: 2, lastContact: "2026-08-24T11:10:00+05:30" },
  { name: "Sneha Patel", city: "Ahmedabad", leak: "payment_failure", amount: 12999, decline: "EXPIRED_CARD", pref: "voice" },
  { name: "Arjun Reddy", city: "Chennai", leak: "payment_failure", amount: 3499, decline: "INSUFFICIENT_FUNDS" },
  { name: "Meera Joshi", city: "Jaipur", leak: "payment_failure", amount: 1599, decline: "INSUFFICIENT_FUNDS", contacts: 3, lastContact: "2026-08-25T18:40:00+05:30" },
  { name: "Kabir Singh", city: "Delhi", leak: "payment_failure", amount: 8999, decline: "DO_NOT_HONOR", flags: ["complaint"], contacts: 2, lastContact: "2026-08-25T12:05:00+05:30" },
  { name: "Diya Nair", city: "Kochi", leak: "payment_failure", amount: 2199, decline: "INSUFFICIENT_FUNDS", flags: ["quiet_hours"] },
  { name: "Ishaan Gupta", city: "Lucknow", leak: "payment_failure", amount: 5499, decline: "EXPIRED_CARD" },
  { name: "Tara Bose", city: "Kolkata", leak: "payment_failure", amount: 999, decline: "INSUFFICIENT_FUNDS", lang: "hindi" },
  { name: "Aditya Rao", city: "Visakhapatnam", leak: "payment_failure", amount: 6499, decline: "DO_NOT_HONOR", retry: 1, lastContact: "2026-08-23T16:20:00+05:30" },
  { name: "Nisha Verma", city: "Indore", leak: "payment_failure", amount: 1799, decline: "INSUFFICIENT_FUNDS" },
  { name: "Farhan Ali", city: "Hyderabad", leak: "payment_failure", amount: 3299, decline: "EXPIRED_CARD", flags: ["dnc"] },
  { name: "Kavya Menon", city: "Bengaluru", leak: "payment_failure", amount: 45999, decline: "EXPIRED_CARD", flags: ["high_aov"], pref: "email", lang: "english" },
  { name: "Dev Malhotra", city: "Chandigarh", leak: "payment_failure", amount: 2499, decline: "INSUFFICIENT_FUNDS", flags: ["fraud"] },

  { name: "Riya Kapoor", city: "Mumbai", leak: "abandoned_checkout", amount: 3899, drop: "price_shock", cart: ["Handloom silk kurta"], pref: "voice" },
  { name: "Aman Jain", city: "Pune", leak: "abandoned_checkout", amount: 1299, drop: "payment_page_drop", cart: ["Organic cotton tee"] },
  { name: "Pooja Desai", city: "Surat", leak: "abandoned_checkout", amount: 2199, drop: "checkout_friction", cart: ["Block-print dupatta"] },
  { name: "Nikhil Bansal", city: "Noida", leak: "abandoned_checkout", amount: 7499, drop: "price_shock", cart: ["Quilted winter jacket"] },
  { name: "Shruti Iyer", city: "Chennai", leak: "abandoned_checkout", amount: 1599, drop: "payment_page_drop", cart: ["Temple-border blouse"] },
  { name: "Harsh Aggarwal", city: "Delhi", leak: "abandoned_checkout", amount: 499, drop: "checkout_friction", cart: ["Canvas tote"] },
  { name: "Anjali Reddy", city: "Hyderabad", leak: "abandoned_checkout", amount: 8999, drop: "price_shock", cart: ["Kalamkari dress"] },
  { name: "Mohit Saxena", city: "Jaipur", leak: "abandoned_checkout", amount: 2599, drop: "payment_page_drop", cart: ["Linen shirt"], flags: ["quiet_hours"] },
  { name: "Leela Krishnan", city: "Coimbatore", leak: "abandoned_checkout", amount: 1899, drop: "checkout_friction", cart: ["Kanjeevaram clutch"], lang: "english" },
  { name: "Yash Thakur", city: "Bhopal", leak: "abandoned_checkout", amount: 3299, drop: "price_shock", cart: ["Indigo denim jacket"] },
  { name: "Fatima Sheikh", city: "Mumbai", leak: "abandoned_checkout", amount: 5499, drop: "payment_page_drop", cart: ["Chanderi kurta set"] },
  { name: "Karan Gill", city: "Amritsar", leak: "abandoned_checkout", amount: 1999, drop: "checkout_friction", cart: ["Phulkari stole"], contacts: 3, lastContact: "2026-08-25T09:15:00+05:30" },

  { name: "Sana Qureshi", city: "Delhi", leak: "failed_subscription", amount: 799, sub: "retry_exhausted", retry: 4 },
  { name: "Rahul Nair", city: "Kochi", leak: "failed_subscription", amount: 1499, sub: "expired_card", decline: "EXPIRED_CARD" },
  { name: "Bhavya Shah", city: "Ahmedabad", leak: "failed_subscription", amount: 999, sub: "mandate_revoked", decline: "MANDATE_REVOKED" },
  { name: "Tejas Kulkarni", city: "Pune", leak: "failed_subscription", amount: 1999, sub: "retry_exhausted", retry: 3 },
  { name: "Anika Bose", city: "Kolkata", leak: "failed_subscription", amount: 599, sub: "forgotten_renewal", lang: "hindi" },
  { name: "Manav Pillai", city: "Bengaluru", leak: "failed_subscription", amount: 2499, sub: "expired_card", decline: "EXPIRED_CARD" },
  { name: "Ritu Agarwal", city: "Lucknow", leak: "failed_subscription", amount: 1299, sub: "retry_exhausted", retry: 3, flags: ["complaint"] },
  { name: "Sameer Khan", city: "Hyderabad", leak: "failed_subscription", amount: 899, sub: "mandate_revoked", decline: "MANDATE_REVOKED" },
  { name: "Aditi Sharma", city: "Jaipur", leak: "failed_subscription", amount: 1699, sub: "forgotten_renewal" },
  { name: "Varun Chopra", city: "Gurugram", leak: "failed_subscription", amount: 2999, sub: "retry_exhausted", retry: 4, flags: ["chargeback"], lang: "english" },

  { name: "Neel Mehta", city: "Nagpur", leak: "overdue_invoice", amount: 186000, invoice: "cashflow_delay", dpd: 62, invoiceNo: "INV-8841", company: "Neel Logistics", segment: "b2b", flags: ["high_aov"], lang: "english", pref: "email" },
  { name: "Asha Rao", city: "Bengaluru", leak: "overdue_invoice", amount: 42000, invoice: "cashflow_delay", dpd: 31, invoiceNo: "INV-8902", company: "Horizon Clinics", segment: "b2b", lang: "english", pref: "email" },
  { name: "Priyanka Oak", city: "Pune", leak: "overdue_invoice", amount: 28500, invoice: "cashflow_delay", dpd: 45, invoiceNo: "INV-8910", company: "Oak & Co", segment: "b2b", lang: "english", pref: "email" },
  { name: "Tanvi Shah", city: "Mumbai", leak: "overdue_invoice", amount: 18000, invoice: "dispute_unaware", dpd: 18, invoiceNo: "INV-8922", company: "Pixel Farm", segment: "b2b", pref: "whatsapp" },
  { name: "Imran Qureshi", city: "Delhi", leak: "overdue_invoice", amount: 9600, invoice: "cashflow_delay", dpd: 22, invoiceNo: "INV-8930", company: "Saffron Traders", segment: "b2b", ptp: "2026-09-04", pref: "whatsapp" },
  { name: "Gurpreet Singh", city: "Ludhiana", leak: "overdue_invoice", amount: 54000, invoice: "cashflow_delay", dpd: 70, invoiceNo: "INV-8944", company: "Northline Apparel", segment: "b2b", flags: ["high_aov"], lang: "english", pref: "email" },
  { name: "Rhea Sen", city: "Kolkata", leak: "overdue_invoice", amount: 12400, invoice: "dispute_unaware", dpd: 15, invoiceNo: "INV-8951", company: "Mint Dental", segment: "b2b" },
  { name: "Alok Tiwari", city: "Varanasi", leak: "overdue_invoice", amount: 22000, invoice: "cashflow_delay", dpd: 28, invoiceNo: "INV-8960", company: "Ganga Wholesale", segment: "b2b", lang: "hindi" },
  { name: "Megha Jain", city: "Jaipur", leak: "overdue_invoice", amount: 8750, invoice: "dispute_unaware", dpd: 12, invoiceNo: "INV-8966", company: "Bluecart Retail", segment: "b2b" },
  { name: "Kiran Das", city: "Surat", leak: "overdue_invoice", amount: 31000, invoice: "cashflow_delay", dpd: 55, invoiceNo: "INV-8972", company: "Kiran Textiles", segment: "b2b", flags: ["legal"], lang: "english", pref: "email" },
];

function occurredAt(index: number): string {
  const d = new Date("2026-08-25T07:40:00+05:30");
  d.setMinutes(d.getMinutes() + index * 17);
  return d.toISOString();
}

function phone(index: number): string {
  const tail = String(412 + index * 7).slice(-3);
  return `+91 98•• ••${tail}`;
}

export function seedCaseFromDraft(draft: Draft, index: number): SeedCase {
  return {
    id: `NV-${1041 + index}`,
    customer: {
      name: draft.name,
      city: draft.city,
      language: draft.lang ?? "hinglish",
      phoneMasked: phone(index),
      channelPref: draft.pref ?? (draft.segment === "b2b" ? "email" : "whatsapp"),
      company: draft.company,
    },
    leakType: draft.leak,
    amountInr: draft.amount,
    occurredAt: occurredAt(index),
    merchantSegment: draft.segment ?? "d2c",
    signals: {
      declineCode: draft.decline,
      dropReason: draft.drop,
      subReason: draft.sub,
      invoiceReason: draft.invoice,
      cartItems: draft.cart,
      invoiceNo: draft.invoiceNo,
      daysPastDue: draft.dpd,
      retryCount: draft.retry ?? 0,
      contactsLast7Days: draft.contacts ?? 0,
      lastContactAt: draft.lastContact,
      promiseToPayDate: draft.ptp,
      flags: draft.flags ?? [],
    },
  };
}

export const SEED_CASES: SeedCase[] = DRAFTS.map(seedCaseFromDraft);

export const MERCHANT = {
  name: "Nivaara",
  desk: "Collections desk",
};

export function exposureOf(cases: { amountInr: number }[]): number {
  return cases.reduce((sum, c) => sum + c.amountInr, 0);
}
