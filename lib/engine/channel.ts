import type { PlayId, RecommendedChannel, SeedCase } from "../types";

export const CHANNEL_LABEL: Record<RecommendedChannel, string> = {
  whatsapp: "WhatsApp",
  sms: "SMS",
  voice: "Voice",
  email: "Email",
  payments: "Payments",
  operator: "Operator",
  none: "None",
};

/** True when RecoverAI does not actually deliver on this channel. */
export function isChannelRecommendationOnly(channel: RecommendedChannel): boolean {
  return channel === "whatsapp" || channel === "sms" || channel === "voice" || channel === "email";
}

/**
 * Channel is derived from the play plus the customer's stated preference.
 * WhatsApp / SMS / voice / email are recommendations only — no sender is wired.
 */
export function recommendChannel(seed: SeedCase, playId: PlayId): RecommendedChannel {
  if (playId === "stop") return "none";
  if (playId === "human_escalate") return "operator";
  if (playId === "smart_retry") return "payments";
  if (playId === "hinglish_voice") return "voice";
  const pref = seed.customer.channelPref;
  if (pref === "email") return "email";
  if (pref === "sms") return "sms";
  return "whatsapp";
}
