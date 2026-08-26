import { CAUSE_LABEL, inr, PLAY_LABEL } from "../format";
import type { Diagnosis, Play, PolicyVerdict, RootCause, SeedCase } from "../types";

function firstName(seed: SeedCase): string {
  return seed.customer.name.split(" ")[0] ?? seed.customer.name;
}

function item(seed: SeedCase): string {
  return seed.signals.cartItems?.[0] ?? "item";
}

export function hinglishScript(seed: SeedCase, cause: RootCause): string {
  const name = firstName(seed);
  const amt = inr(seed.amountInr);
  switch (cause) {
    case "insufficient_funds":
      return `Namaste ${name} ji, Nivaara se Priya bol rahi hoon. Aapka ${amt} ka payment fail ho gaya tha — bank ne bola funds kam the. Koi tension nahi. Jab aapke liye theek ho, main WhatsApp pe ek secure link bhej deti hoon, uspe retry kar lijiye.`;
    case "expired_card":
      return `Hi ${name}, Nivaara se call hai. Aapka saved card expire ho chuka hai, isliye ${amt} nahi kat paya. Naya UPI ya card add karne ke liye main ek link bhej rahi hoon — 2 minute ka kaam hai.`;
    case "bank_decline":
      return `${name} ji, Nivaara se baat ho rahi hai. Bank ne ${amt} decline kar diya. Hum dubara attempt nahi karenge aapke bina. Agar aap ready hain to main abhi payment link bhej duun?`;
    case "mandate_revoked":
      return `Namaste ${name}, Nivaara Plus ki auto-pay cancel ho gayi hai. Membership ${amt} pe hold hai. Nayi mandate ke liye short link bhej duun WhatsApp pe?`;
    case "price_shock":
      return `Hi ${name}, Nivaara se hoon. Aapne ${item(seed)} cart mein chhoda tha — ${amt}. Agar price ki wajah se hold kiya hai, aaj ke liye extra 10 percent off laga deti hoon, 30 minute ke liye valid. Link bhej duun?`;
    case "checkout_friction":
      return `${name} ji, lagta hai checkout pe kuch atak gaya. Main aapko pre-filled payment link bhej rahi hoon — address dobara nahi bharna. ${amt} ka order hold pe hai.`;
    case "payment_page_drop":
      return `Namaste ${name}, Nivaara se. Aap payment page tak gaye the ${item(seed)} ke liye. Link abhi bhejti hoon, isi call pe complete kar sakte ho. Amount ${amt}.`;
    case "retry_exhausted":
      return `${name} ji, Nivaara Plus ka ${amt} ka renewal fail ho chuka hai kai baar. Auto-debit bandh karti hoon. Aap jab ready ho, is link se ek baar pay kar lijiye — membership wahi se continue hogi.`;
    case "cashflow_delay":
      return `Namaste ${name} ji, Nivaara accounts se. ${seed.signals.invoiceNo ?? "Invoice"} ${amt} pending hai. Agar is hafte tight hai, ek promise-to-pay date de dijiye — us din tak reminder nahi bhejenge.`;
    case "dispute_unaware":
      return `${name} ji, ${seed.signals.invoiceNo ?? "invoice"} ${amt} aapke board pe pending dikh raha hai. Main PDF WhatsApp pe bhej rahi hoon. Check karke confirm kar dijiye.`;
    case "forgotten_renewal":
      return `Hi ${name}, Nivaara Plus ka renewal nikal gaya — ${amt}. Koi penalty nahi. Link pe tap karke same plan continue kar sakte ho.`;
  }
}

function linkCopy(seed: SeedCase, cause: RootCause): string {
  const name = firstName(seed);
  return `Hi ${name}, Nivaara here. ${CAUSE_LABEL[cause]} on ${inr(seed.amountInr)}. Pay on this secure link — we will not retry the old instrument.`;
}

export function selectPlay(seed: SeedCase, diagnosis: Diagnosis, policy: PolicyVerdict): Play {
  if (policy.action === "stop") {
    return {
      id: "stop",
      label: PLAY_LABEL.stop,
      channel: "none",
      reason: policy.reason,
    };
  }
  if (policy.action === "hold") {
    const ptp = policy.ruleId === "promise-to-pay";
    return {
      id: ptp ? "promise_to_pay" : "stop",
      label: ptp ? PLAY_LABEL.promise_to_pay : "Defer",
      channel: "none",
      reason: policy.reason,
    };
  }
  if (policy.action === "escalate") {
    return {
      id: "human_escalate",
      label: PLAY_LABEL.human_escalate,
      channel: "operator",
      reason: policy.reason,
    };
  }

  const cause = diagnosis.rootCause;
  const langOk = seed.customer.language !== "english";

  if (cause === "insufficient_funds" && seed.signals.retryCount < 2) {
    return {
      id: "smart_retry",
      label: PLAY_LABEL.smart_retry,
      channel: "payments",
      reason: "Retryable NSF. Schedule one delayed debit; do not stack same-day attempts.",
    };
  }
  if (cause === "expired_card" || cause === "mandate_revoked" || cause === "checkout_friction") {
    return {
      id: "payment_link",
      label: PLAY_LABEL.payment_link,
      channel: seed.customer.channelPref === "email" ? "email" : "whatsapp",
      reason: "Need a new instrument or a frictionless checkout. Send a single-use link.",
      script: linkCopy(seed, cause),
    };
  }
  if (cause === "cashflow_delay") {
    return {
      id: "promise_to_pay",
      label: PLAY_LABEL.promise_to_pay,
      channel: "whatsapp",
      reason: "Cashflow delay. Capture a dated promise instead of another reminder.",
      script: hinglishScript(seed, cause),
    };
  }
  if (cause === "dispute_unaware") {
    return {
      id: "payment_link",
      label: PLAY_LABEL.payment_link,
      channel: "email",
      reason: "Customer may not have seen the invoice. Send statement + pay link once.",
      script: linkCopy(seed, cause),
    };
  }
  if (
    langOk &&
    (cause === "price_shock" ||
      cause === "payment_page_drop" ||
      cause === "forgotten_renewal" ||
      cause === "bank_decline" ||
      (cause === "insufficient_funds" && seed.signals.retryCount >= 2) ||
      cause === "retry_exhausted")
  ) {
    return {
      id: "hinglish_voice",
      label: PLAY_LABEL.hinglish_voice,
      channel: "voice",
      reason: "Objection or drop-off needs a conversation. One bounded Hinglish call, then stop.",
      script: hinglishScript(seed, cause),
    };
  }
  if (cause === "retry_exhausted" || cause === "bank_decline") {
    return {
      id: "payment_link",
      label: PLAY_LABEL.payment_link,
      channel: "whatsapp",
      reason: "Retries are done. Move the customer onto a new payment link.",
      script: linkCopy(seed, cause),
    };
  }
  return {
    id: "payment_link",
    label: PLAY_LABEL.payment_link,
    channel: "whatsapp",
    reason: "Default bounded play: one payment link, no further retries this cycle.",
    script: linkCopy(seed, cause),
  };
}
