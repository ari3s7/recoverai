import type { PlayId } from "../types";

const LINK_INTENT = /link\s*bhej|payment\s*link|pay\s*kar|bhej\s*do/i;
const LATER_INTENT = /baad\s*mein|next\s*week|kal\s*(kar|de)|promise/i;
const STOP_INTENT = /mat\s*call|dnc|unsubscribe|pareshan/i;

/** Bounded intent map for the Hinglish voice demo — not an open-ended NLU stack. */
export function interpretCustomerIntent(utterance: string): { play: PlayId; reply: string } | null {
  const text = utterance.trim();
  if (!text) return null;
  if (STOP_INTENT.test(text)) {
    return { play: "stop", reply: "Theek hai, main ab call nahi karungi. Sorry for the disturbance." };
  }
  if (LATER_INTENT.test(text)) {
    return {
      play: "promise_to_pay",
      reply: "Bilkul, date note kar leti hoon. Us din tak reminder nahi bhejenge.",
    };
  }
  if (LINK_INTENT.test(text)) {
    return {
      play: "payment_link",
      reply: "Bilkul, main payment link bhej raha hoon.",
    };
  }
  return null;
}
