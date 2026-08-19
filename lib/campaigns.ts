import { CURRENCY } from "@/lib/format";
import type { CustomerProfile } from "@/lib/segments";
import type { SegmentDefinition } from "@/lib/segments";

// --- Campaign types -------------------------------------------------------------

export type CampaignChannel = "whatsapp" | "email" | "sms" | "telegram" | "line";

export type OfferType = "percent" | "amount";

export type Campaign = {
  id: string;
  created_at: string;
  name: string;
  segment_id: string | null;
  segment_name: string;
  definition: SegmentDefinition;
  channel: CampaignChannel;
  subject: string | null;
  body: string;
  recipient_count: number;
  created_by: string | null;
  completed_at: string | null;
  offer_code: string | null;
  offer_type: OfferType | null;
  offer_value: number | null; // percent (1-100) or cents, by offer_type
};

// The discount a campaign's offer takes off a cart, capped at the cart total.
export function offerDiscountCents(
  campaign: Pick<Campaign, "offer_type" | "offer_value">,
  cartTotalCents: number,
): number {
  if (!campaign.offer_type || !campaign.offer_value) return 0;
  const raw =
    campaign.offer_type === "percent"
      ? Math.round((cartTotalCents * campaign.offer_value) / 100)
      : campaign.offer_value;
  return Math.max(0, Math.min(raw, cartTotalCents));
}

export function offerLabel(
  campaign: Pick<Campaign, "offer_type" | "offer_value">,
): string {
  if (!campaign.offer_type || !campaign.offer_value) return "";
  return campaign.offer_type === "percent"
    ? `${campaign.offer_value}% off`
    : `${CURRENCY}${(campaign.offer_value / 100).toFixed(2)} off`;
}

export function suggestOfferCode(name: string): string {
  const base = name.replace(/[^a-zA-Z]/g, "").toUpperCase().slice(0, 8);
  return (base || "RICEMICE") + String(Math.floor(10 + Math.random() * 90));
}

// --- Channel registry -------------------------------------------------------------
// `manual` = the app composes a per-recipient deep link and the staff click IS
// the send — works with no API key. Channels without a manual mode need a
// connected provider AND a way to address customers before they can send; that
// live status is computed by channelStatuses() below, not hardcoded here.

export type ChannelDef = {
  id: CampaignChannel;
  label: string;
  manual: boolean; // has a built-in deep-link send that needs no provider
  hint: string;
  // The address a campaign on this channel would use, or null when the customer
  // lacks consent or contact info for it. Consent is enforced HERE, so no send
  // path can ever see a non-consenting recipient. Channels we can't yet address
  // (Telegram/LINE — no stored chat id) return null for everyone.
  address: (p: CustomerProfile) => string | null;
};

export const CHANNELS: ChannelDef[] = [
  {
    id: "whatsapp",
    label: "WhatsApp",
    manual: true,
    hint: "Opens WhatsApp with the message pre-filled — you press send",
    address: (p) => (p.whatsappOptIn && p.phone ? p.phone : null),
  },
  {
    id: "email",
    label: "Email",
    manual: true,
    hint: "Opens your mail app with the message pre-filled — you press send",
    address: (p) => (p.emailOptIn && p.email ? p.email : null),
  },
  {
    id: "sms",
    label: "SMS",
    manual: false,
    hint: "Text message, once an SMS provider is connected",
    address: (p) => (p.smsOptIn && p.phone ? p.phone : null),
  },
  {
    id: "telegram",
    label: "Telegram",
    manual: false,
    hint: "Telegram bot message",
    address: () => null,
  },
  {
    id: "line",
    label: "LINE",
    manual: false,
    hint: "LINE message",
    address: () => null,
  },
];

export function channelDef(id: CampaignChannel): ChannelDef {
  return CHANNELS.find((c) => c.id === id) ?? CHANNELS[0];
}

// --- Live channel availability ------------------------------------------------
// Bridges the connected providers (Settings → Channel providers) to what the
// campaign composer may actually offer. Three states:
//  - "ready":          can send today (manual deep-link, or a wired provider)
//  - "connected_setup": a provider IS connected but campaign sending isn't
//                       possible yet (Telegram/LINE have no per-customer id
//                       to address) — shown, not selectable
//  - "not_connected":  no provider and no manual mode
// Only "ready" channels are selectable, so the composer never offers a channel
// it can't actually send — no dead ends.

export type ChannelConnectivity = Partial<Record<CampaignChannel, boolean>>;
export type ChannelSendState = "ready" | "connected_setup" | "not_connected";

export type ChannelStatus = {
  id: CampaignChannel;
  label: string;
  state: ChannelSendState;
  selectable: boolean;
  note: string;
  direct: boolean; // sends immediately from the app, vs. opening an external app
};

export function channelStatuses(connected: ChannelConnectivity = {}): ChannelStatus[] {
  return CHANNELS.map((ch): ChannelStatus => {
    const isConnected = !!connected[ch.id];

    if (ch.id === "email") {
      return {
        id: ch.id,
        label: ch.label,
        state: "ready",
        selectable: true,
        direct: isConnected,
        note: isConnected
          ? "Sends directly from the app when you run the campaign — you still approve each recipient."
          : "Opens your mail app with the message pre-filled — you press send. Connect Resend in Settings to send directly.",
      };
    }

    if (ch.id === "whatsapp") {
      return {
        id: ch.id,
        label: ch.label,
        state: "ready",
        selectable: true,
        direct: isConnected,
        note: isConnected
          ? "Sends directly from the app when you run the campaign — you still approve each recipient."
          : "Opens WhatsApp with the message pre-filled — you press send. Connect WhatsApp Business (Cloud API) in Settings, with an approved template, to send directly.",
      };
    }

    if (ch.id === "sms") {
      return {
        id: ch.id,
        label: ch.label,
        state: isConnected ? "ready" : "not_connected",
        selectable: isConnected,
        direct: isConnected,
        note: isConnected
          ? "Sends directly from the app when you run the campaign — you still approve each recipient."
          : `Not connected — add ${ch.label} in Settings → Channel providers.`,
      };
    }

    // Telegram / LINE: no manual mode, and sending needs a per-customer id we
    // don't capture yet. Reflect the connection honestly but stay non-selectable.
    if (isConnected) {
      const note =
        ch.id === "telegram"
          ? "Connected — sending needs each customer's Telegram chat id (captured when they message your bot), coming soon."
          : "Connected — sending needs each customer's LINE id, coming soon.";
      return {
        id: ch.id,
        label: ch.label,
        state: "connected_setup",
        selectable: false,
        direct: false,
        note,
      };
    }

    return {
      id: ch.id,
      label: ch.label,
      state: "not_connected",
      selectable: false,
      direct: false,
      note: `Not connected — add ${ch.label} in Settings → Channel providers.`,
    };
  });
}

// --- Message composition -----------------------------------------------------------

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://rice-mice.vercel.app";

export function renderTemplate(
  body: string,
  // Narrowed from CustomerProfile to what this actually reads, so the send
  // paths can render a subject line from a plain customer row.
  p: Pick<CustomerProfile, "firstName" | "lastName">,
  offerCode?: string | null,
): string {
  return body
    .replaceAll("{{name}}", p.firstName)
    .replaceAll("{{full_name}}", `${p.firstName} ${p.lastName}`.trim())
    .replaceAll("{{code}}", offerCode ?? "");
}

// The subject is the one piece of copy stored once per CAMPAIGN rather than
// once per recipient, so it is the only one that never went through
// composeMessage — a {{name}} typed into it shipped to everybody literally.
// Rendered here at send time instead, by both the API path and the mailto
// fallback. Found Sprint 60, when the copilot started drafting subject lines
// and made a rare hand-typed footgun the default.
export function renderSubject(
  subject: string | null,
  p: { first_name?: string | null; last_name?: string | null } | null,
  offerCode?: string | null,
): string | null {
  if (!subject) return null;
  return renderTemplate(
    subject,
    { firstName: p?.first_name ?? "", lastName: p?.last_name ?? "" },
    offerCode,
  );
}

export function unsubscribeUrl(token: string): string {
  return `${APP_URL}/unsubscribe/${token}`;
}

// The exact text a recipient receives: personalised body + the legally required
// opt-out. This is what gets stored in engagement_logs.message_draft, so the log
// is a faithful record of what was sent. (unsubscribe_token is NOT NULL in the
// DB; the fallback only exists to satisfy the nullable profile type.)
//
// Sprint 62: "reply" is offered only where a reply can actually be HEARD —
// which since Sprint 61 means a shop whose WhatsApp Cloud API webhook is live,
// because that is what turns the word STOP into whatsapp_opt_in = false. A long
// unsubscribe URL is the wrong shape for a chat message, but printing
// "Reply STOP" where nothing is listening would be worse than ugly: an opt-out
// that silently does nothing. Callers that cannot prove the webhook is live
// keep the link.
export type OptOutStyle = "link" | "reply";

export function composeMessage(
  body: string,
  p: CustomerProfile,
  offerCode?: string | null,
  optOut: OptOutStyle = "link",
): string {
  const footer =
    optOut === "reply"
      ? "Reply STOP to opt out."
      : `Unsubscribe: ${unsubscribeUrl(p.unsubscribeToken ?? "")}`;
  return `${renderTemplate(body, p, offerCode)}\n\n${footer}`;
}

// --- Manual-mode deep links ---------------------------------------------------------

export function sendLink(
  channel: CampaignChannel,
  address: string,
  subject: string | null,
  text: string,
): string | null {
  if (channel === "whatsapp") {
    const digits = address.replace(/\D/g, "");
    return digits ? `https://wa.me/${digits}?text=${encodeURIComponent(text)}` : null;
  }
  if (channel === "email") {
    const params = new URLSearchParams();
    if (subject) params.set("subject", subject);
    params.set("body", text);
    return `mailto:${address}?${params.toString().replace(/\+/g, "%20")}`;
  }
  return null;
}
