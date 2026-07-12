// Channel provider catalog + pure plumbing (masking, payload builders,
// validation). No secrets live here and nothing reads the database — this
// module stays importable from client components and unit tests. Reading and
// writing the actual credentials happens only in server code
// (lib/providerConfig.ts and app/actions/providers.ts).

export type ProviderId =
  | "resend"
  | "whatsapp"
  | "twilio_sms"
  | "telegram"
  | "line";

export type ProviderFieldDef = {
  key: string;
  label: string;
  secret?: boolean; // stored value is never sent to the browser unmasked
  optional?: boolean;
  placeholder?: string;
  help?: string;
};

// How the "Test" button exercises a provider:
//  - "send": delivers a fixed test message to an address/number you type
//  - "verify": calls the provider's identity endpoint to validate the token
//    (used where a real send needs per-customer ids we don't capture yet)
export type ProviderTestKind = "send" | "verify";

export type ProviderDef = {
  id: ProviderId;
  label: string;
  channel: string; // which rice-mice channel this powers
  blurb: string;
  docsUrl: string;
  fields: ProviderFieldDef[];
  test: ProviderTestKind;
  testTargetLabel?: string; // for "send" tests: what to type in the target box
  note?: string; // honest caveats shown on the card
};

export const PROVIDERS: ProviderDef[] = [
  {
    id: "resend",
    label: "Resend",
    channel: "Email (EDM)",
    blurb:
      "Powers the Send buttons on campaigns and the action inbox — approved drafts go straight out instead of via your mail app.",
    docsUrl: "https://resend.com/api-keys",
    fields: [
      {
        key: "api_key",
        label: "API key",
        secret: true,
        placeholder: "re_…",
      },
      {
        key: "from",
        label: "From address",
        optional: true,
        placeholder: "Rice Mice <hello@yourdomain.com>",
        help: "Leave blank to use Resend's shared onboarding sender (delivers only to your own inbox until you verify a domain).",
      },
    ],
    test: "send",
    testTargetLabel: "Send a test email to",
  },
  {
    id: "whatsapp",
    label: "WhatsApp Business (Cloud API)",
    channel: "WhatsApp",
    blurb:
      "Meta's official API. Until connected, WhatsApp sends keep working as wa.me deep-links from your own phone.",
    docsUrl: "https://developers.facebook.com/docs/whatsapp/cloud-api/get-started",
    fields: [
      {
        key: "access_token",
        label: "Access token",
        secret: true,
        placeholder: "EAAG…",
      },
      {
        key: "phone_number_id",
        label: "Phone number ID",
        placeholder: "1055…",
        help: "From Meta's WhatsApp → API Setup page — the numeric id, not the phone number.",
      },
    ],
    test: "send",
    testTargetLabel: "Send the hello_world template to",
    note: "Marketing blasts need Meta-approved message templates; the test uses the built-in hello_world template.",
  },
  {
    id: "twilio_sms",
    label: "Twilio SMS",
    channel: "SMS",
    blurb: "Plain text messages for customers who aren't on WhatsApp or email.",
    docsUrl: "https://www.twilio.com/docs/sms",
    fields: [
      { key: "account_sid", label: "Account SID", placeholder: "AC…" },
      { key: "auth_token", label: "Auth token", secret: true },
      {
        key: "from_number",
        label: "From number",
        placeholder: "+15551234567",
        help: "A Twilio number you own, in international format.",
      },
    ],
    test: "send",
    testTargetLabel: "Send a test SMS to",
  },
  {
    id: "telegram",
    label: "Telegram bot",
    channel: "Telegram",
    blurb: "Store your bot token now; the Test button verifies it with Telegram.",
    docsUrl: "https://core.telegram.org/bots#how-do-i-create-a-bot",
    fields: [
      {
        key: "bot_token",
        label: "Bot token",
        secret: true,
        placeholder: "123456:ABC-…",
      },
    ],
    test: "verify",
    note: "Sending needs each customer's chat id, which Telegram only reveals after they message your bot — customer chat-id capture is a future sprint, so this is config-only for now.",
  },
  {
    id: "line",
    label: "LINE Messaging API",
    channel: "LINE",
    blurb: "Store your channel access token now; the Test button verifies it with LINE.",
    docsUrl: "https://developers.line.biz/en/docs/messaging-api/getting-started/",
    fields: [
      {
        key: "channel_access_token",
        label: "Channel access token",
        secret: true,
      },
    ],
    test: "verify",
    note: "Sending needs each customer's LINE user id (captured when they add your official account) — config-only until that capture exists.",
  },
];

export const PROVIDERS_BY_ID: Record<string, ProviderDef> = Object.fromEntries(
  PROVIDERS.map((p) => [p.id, p]),
);

// Which campaign channel each provider powers. Keyed by provider id; the value
// matches CampaignChannel in lib/campaigns.ts (kept as a string here to avoid a
// circular import — campaigns.ts imports from this module's siblings).
export const PROVIDER_CHANNEL: Record<ProviderId, string> = {
  resend: "email",
  whatsapp: "whatsapp",
  twilio_sms: "sms",
  telegram: "telegram",
  line: "line",
};

// --- Masking -------------------------------------------------------------
// What the browser is allowed to see of a stored secret: enough to recognise
// which key is saved ("re_a…9fQx"), never enough to use it.

export function maskSecret(value: string): string {
  const v = value.trim();
  if (!v) return "";
  if (v.length <= 12) return "••••••";
  return `${v.slice(0, 4)}…${v.slice(-4)}`;
}

// The shape the Settings page ships to the browser: secret fields masked,
// non-secret fields verbatim.
export type ProviderView = {
  id: ProviderId;
  enabled: boolean;
  configured: boolean; // all required fields present (server-side truth)
  values: Record<string, string>;
};

export function toProviderView(
  def: ProviderDef,
  row: { enabled: boolean; config: Record<string, unknown> } | null,
): ProviderView {
  const config = row?.config ?? {};
  const values: Record<string, string> = {};
  for (const f of def.fields) {
    const raw = typeof config[f.key] === "string" ? (config[f.key] as string) : "";
    values[f.key] = f.secret ? maskSecret(raw) : raw;
  }
  return {
    id: def.id,
    enabled: !!row?.enabled,
    configured: isProviderConfigured(def, config),
    values,
  };
}

export function isProviderConfigured(
  def: ProviderDef,
  config: Record<string, unknown>,
): boolean {
  return def.fields.every(
    (f) =>
      f.optional ||
      (typeof config[f.key] === "string" && (config[f.key] as string).trim() !== ""),
  );
}

// --- Validation ----------------------------------------------------------
// Returns an error message, or null when the config is usable. Deliberately
// shallow — the provider is the real validator; this catches obvious slips
// before a key gets saved.

export function validateProviderConfig(
  def: ProviderDef,
  config: Record<string, string>,
): string | null {
  for (const f of def.fields) {
    const v = (config[f.key] ?? "").trim();
    if (!v) {
      if (!f.optional) return `${f.label} is required`;
      continue;
    }
    if (f.key === "phone_number_id" && !/^\d{5,}$/.test(v))
      return "Phone number ID should be the numeric id from Meta, not a phone number";
    if (f.key === "from_number" && normalizePhone(v) === null)
      return "From number doesn't look like an international phone number";
    if (f.key === "from" && !v.includes("@"))
      return "From address needs an email in it";
    if (f.key === "account_sid" && !/^AC[0-9a-fA-F]{10,}$/.test(v))
      return "Account SID should start with AC";
  }
  return null;
}

// --- Send plumbing (pure, unit-tested) ------------------------------------

// Fixed server-side test copy: the test button can never be used to send
// arbitrary content, only this.
export const TEST_MESSAGE =
  "Test message from your rice-mice CRM — your provider connection works. 🍚";

// Accepts human-formatted numbers ("+27 82 555-1234"), returns bare digits
// (no +) or null if it can't be a phone number. WhatsApp's Cloud API wants
// digits; Twilio wants +digits — callers add the + where needed.
export function normalizePhone(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const digits = trimmed.replace(/[\s\-().]/g, "").replace(/^\+/, "");
  if (!/^\d{8,15}$/.test(digits)) return null;
  return digits;
}

export function whatsAppEndpoint(phoneNumberId: string): string {
  return `https://graph.facebook.com/v20.0/${encodeURIComponent(phoneNumberId.trim())}/messages`;
}

export type WhatsAppPayload = {
  messaging_product: "whatsapp";
  to: string;
  type: "text" | "template";
  text?: { body: string };
  template?: { name: string; language: { code: string } };
};

// Free-form text — only deliverable inside WhatsApp's 24-hour customer
// service window (after the customer last messaged you).
export function buildWhatsAppTextPayload(
  to: string,
  body: string,
): WhatsAppPayload | { error: string } {
  const digits = normalizePhone(to);
  if (!digits) return { error: "Recipient phone number looks invalid" };
  const text = body.trim();
  if (!text) return { error: "Message is empty" };
  return { messaging_product: "whatsapp", to: digits, type: "text", text: { body: text } };
}

// Template send — works outside the 24-hour window; hello_world ships with
// every WhatsApp Business account, which is why the test uses it.
export function buildWhatsAppTemplatePayload(
  to: string,
  templateName = "hello_world",
  languageCode = "en_US",
): WhatsAppPayload | { error: string } {
  const digits = normalizePhone(to);
  if (!digits) return { error: "Recipient phone number looks invalid" };
  return {
    messaging_product: "whatsapp",
    to: digits,
    type: "template",
    template: { name: templateName, language: { code: languageCode } },
  };
}

export function twilioEndpoint(accountSid: string): string {
  return `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid.trim())}/Messages.json`;
}

// Twilio takes application/x-www-form-urlencoded; returns the params or an
// error. Both numbers are normalised to +E.164.
export function buildTwilioSmsParams(input: {
  from: string;
  to: string;
  body: string;
}): { From: string; To: string; Body: string } | { error: string } {
  const from = normalizePhone(input.from);
  if (!from) return { error: "From number looks invalid" };
  const to = normalizePhone(input.to);
  if (!to) return { error: "Recipient phone number looks invalid" };
  const body = input.body.trim();
  if (!body) return { error: "Message is empty" };
  return { From: `+${from}`, To: `+${to}`, Body: body };
}

export function telegramVerifyEndpoint(botToken: string): string {
  return `https://api.telegram.org/bot${botToken.trim()}/getMe`;
}

export const LINE_VERIFY_ENDPOINT = "https://api.line.me/v2/bot/info";
