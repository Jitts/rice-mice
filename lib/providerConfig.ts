// SERVER ONLY — reads channel provider credentials. channel_providers has RLS
// enabled with no policies, so the only way to it is the service-role client;
// keep this module out of client components (it would silently return nulls
// in the browser, but nothing here belongs there).

import { createAdminClient } from "@/lib/supabase/admin";
import {
  isProviderConfigured,
  PROVIDER_CHANNEL,
  PROVIDERS,
  PROVIDERS_BY_ID,
  toProviderView,
  type ProviderId,
  type ProviderView,
} from "@/lib/providers";
import type { ChannelConnectivity } from "@/lib/campaigns";

type ProviderRow = {
  id: string;
  enabled: boolean;
  config: Record<string, unknown>;
};

// Raw config for one provider, or null when the row is missing, disabled, or
// the admin client isn't configured. Callers treat null as "provider off".
// Scoped to one business — the admin client bypasses RLS, so the filter here
// IS the tenant boundary.
export async function getProviderConfig(
  businessId: string | null,
  id: ProviderId,
): Promise<Record<string, string> | null> {
  const admin = createAdminClient();
  if (!admin || !businessId) return null;
  const { data } = await admin
    .from("channel_providers")
    .select("enabled, config")
    .eq("business_id", businessId)
    .eq("id", id)
    .maybeSingle();
  if (!data?.enabled) return null;
  const config = (data.config ?? {}) as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(config)) {
    if (typeof v === "string") out[k] = v;
  }
  return out;
}

// Resend credentials: the Settings-managed row wins; the original env vars
// (RESEND_API_KEY / RESEND_FROM) still work as a fallback so nothing breaks
// for anyone who configured email the pre-Settings way.
export async function getResendConfig(businessId: string | null): Promise<{
  apiKey: string;
  from: string | null;
} | null> {
  const db = await getProviderConfig(businessId, "resend");
  if (db?.api_key?.trim()) {
    return { apiKey: db.api_key.trim(), from: db.from?.trim() || null };
  }
  const envKey = process.env.RESEND_API_KEY;
  if (envKey) return { apiKey: envKey, from: process.env.RESEND_FROM || null };
  return null;
}

// Drives whether the campaign/inbox UI shows direct-send buttons.
export async function emailProviderReady(
  businessId: string | null,
): Promise<boolean> {
  return (await getResendConfig(businessId)) !== null;
}

// Twilio SMS credentials — Settings-managed only (no legacy env fallback;
// unlike Resend, there was never a pre-Settings Twilio integration).
export async function getTwilioConfig(businessId: string | null): Promise<{
  accountSid: string;
  authToken: string;
  fromNumber: string;
} | null> {
  const db = await getProviderConfig(businessId, "twilio_sms");
  if (!db?.account_sid?.trim() || !db?.auth_token?.trim() || !db?.from_number?.trim())
    return null;
  return {
    accountSid: db.account_sid.trim(),
    authToken: db.auth_token.trim(),
    fromNumber: db.from_number.trim(),
  };
}

// Drives whether the campaign UI shows direct-send buttons for SMS.
export async function smsProviderReady(businessId: string | null): Promise<boolean> {
  return (await getTwilioConfig(businessId)) !== null;
}

// WhatsApp Cloud API credentials + the approved marketing template a business
// registers once Meta approves it. Sending a template needs an exact template
// name and, for templates with variables, positional parameter values — the
// business supplies both here rather than us guessing template structure.
export async function getWhatsAppConfig(businessId: string | null): Promise<{
  accessToken: string;
  phoneNumberId: string;
  templateName: string;
  templateLanguage: string;
  templateVars: string[];
} | null> {
  const db = await getProviderConfig(businessId, "whatsapp");
  if (!db?.access_token?.trim() || !db?.phone_number_id?.trim() || !db?.template_name?.trim())
    return null;
  return {
    accessToken: db.access_token.trim(),
    phoneNumberId: db.phone_number_id.trim(),
    templateName: db.template_name.trim(),
    templateLanguage: db.template_language?.trim() || "en_US",
    templateVars: (db.template_vars ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  };
}

// Drives whether the campaign UI shows direct-send buttons for WhatsApp. The
// Cloud API connection alone isn't enough — campaign sends need an approved
// template too (see getWhatsAppConfig), unlike the Test button which always
// uses Meta's built-in hello_world template.
export async function whatsappProviderReady(businessId: string | null): Promise<boolean> {
  return (await getWhatsAppConfig(businessId)) !== null;
}

// Which campaign channels currently have a connected (enabled + fully
// configured) provider. Returns only booleans — safe to hand to the client
// so the composer can reflect what's connected. Email also counts as connected
// via the legacy RESEND_API_KEY env fallback.
export async function connectedChannels(
  businessId: string | null,
): Promise<ChannelConnectivity> {
  const connected: ChannelConnectivity = {};
  const admin = createAdminClient();
  if (admin && businessId) {
    const { data } = await admin
      .from("channel_providers")
      .select("id, enabled, config")
      .eq("business_id", businessId);
    for (const row of (data ?? []) as ProviderRow[]) {
      const def = PROVIDERS_BY_ID[row.id];
      const channel = PROVIDER_CHANNEL[row.id as ProviderId];
      if (!def || !channel) continue;
      if (row.enabled && isProviderConfigured(def, (row.config ?? {}) as Record<string, unknown>)) {
        connected[channel as keyof ChannelConnectivity] = true;
      }
    }
  }
  if (!connected.email && (await getResendConfig(businessId)))
    connected.email = true;
  // WhatsApp's base creds alone would satisfy the generic loop above (template
  // fields are optional so the Test button keeps working without one), but
  // campaign sending also needs an approved template — override with the
  // stricter check so the composer never claims "ready" prematurely.
  connected.whatsapp = await whatsappProviderReady(businessId);
  return connected;
}

// Masked views for the Settings page. Only call this AFTER verifying the
// caller holds the 'providers' permission — even masked values stay off the
// wire for everyone else.
export async function listProviderViews(
  businessId: string | null,
): Promise<ProviderView[]> {
  const admin = createAdminClient();
  const rows: ProviderRow[] = [];
  if (admin && businessId) {
    const { data } = await admin
      .from("channel_providers")
      .select("id, enabled, config")
      .eq("business_id", businessId);
    rows.push(...((data ?? []) as ProviderRow[]));
  }
  const byId = new Map(rows.map((r) => [r.id, r]));
  return PROVIDERS.map((def) => {
    const row = byId.get(def.id);
    return toProviderView(
      def,
      row
        ? { enabled: row.enabled, config: (row.config ?? {}) as Record<string, unknown> }
        : null,
    );
  });
}

export function providerDefOrNull(id: string) {
  return PROVIDERS_BY_ID[id] ?? null;
}
