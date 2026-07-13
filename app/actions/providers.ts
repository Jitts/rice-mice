"use server";

// Channel provider administration. Every action re-verifies server-side that
// the CALLER's role includes the 'providers' permission before touching the
// service-role client. Secrets flow browser → here on save, and only masked
// views flow back; a stored secret is never returned. The Test button sends
// FIXED server-side content (TEST_MESSAGE / hello_world) to a target the
// permission-gated caller types — it cannot compose messages.

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  PROVIDERS_BY_ID,
  TEST_MESSAGE,
  LINE_VERIFY_ENDPOINT,
  buildTwilioSmsParams,
  buildWhatsAppTemplatePayload,
  telegramVerifyEndpoint,
  toProviderView,
  twilioEndpoint,
  validateProviderConfig,
  whatsAppEndpoint,
  type ProviderView,
} from "@/lib/providers";
import { buildResendPayload, DEFAULT_FROM, RESEND_ENDPOINT } from "@/lib/email";

export type ProviderSaveResult =
  | { ok: true; view: ProviderView }
  | { ok: false; error: string };

export type ProviderTestResult =
  | { ok: true; detail: string }
  | { ok: false; error: string };

async function requireProvidersCaller(): Promise<
  | { ok: true; displayName: string | null; businessId: string }
  | { ok: false; error: string }
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in" };
  const [{ data: membership }, { data: profile }] = await Promise.all([
    supabase
      .from("memberships")
      .select("business_id, roles(permissions)")
      .maybeSingle(),
    supabase
      .from("staff_profiles")
      .select("display_name")
      .eq("id", user.id)
      .maybeSingle(),
  ]);
  const m = membership as {
    business_id: string;
    roles: { permissions: string[] } | null;
  } | null;
  const perms = m?.roles?.permissions ?? [];
  if (!m || (!perms.includes("*") && !perms.includes("providers")))
    return { ok: false, error: "Your role doesn't include channel providers" };
  return {
    ok: true,
    displayName: profile?.display_name ?? null,
    businessId: m.business_id,
  };
}

function admin() {
  const client = createAdminClient();
  if (!client)
    throw new Error(
      "Provider admin isn't configured — SUPABASE_SERVICE_ROLE_KEY is missing",
    );
  return client;
}

// Saves a provider's config. Secret fields arriving as "" mean "keep what's
// stored" (the form shows a mask, not the value, so an untouched field comes
// back empty); anything non-empty replaces. Enabling requires a config that
// passes validation — you can save half-finished credentials, just not turn
// them on.
export async function saveProvider(
  id: string,
  values: Record<string, string>,
  enabled: boolean,
): Promise<ProviderSaveResult> {
  const gate = await requireProvidersCaller();
  if (!gate.ok) return gate;
  const def = PROVIDERS_BY_ID[id];
  if (!def) return { ok: false, error: "Unknown provider" };

  try {
    const api = admin();
    const { data: existing } = await api
      .from("channel_providers")
      .select("config")
      .eq("business_id", gate.businessId)
      .eq("id", id)
      .maybeSingle();
    const stored = (existing?.config ?? {}) as Record<string, unknown>;

    const merged: Record<string, string> = {};
    for (const f of def.fields) {
      const incoming = (values[f.key] ?? "").trim();
      const kept = typeof stored[f.key] === "string" ? (stored[f.key] as string) : "";
      merged[f.key] = f.secret && incoming === "" ? kept : incoming;
    }

    if (enabled) {
      const invalid = validateProviderConfig(def, merged);
      if (invalid) return { ok: false, error: `Can't enable yet — ${invalid}` };
    }

    const { error } = await api
      .from("channel_providers")
      .update({
        config: merged,
        enabled,
        updated_at: new Date().toISOString(),
        updated_by: gate.displayName,
      })
      .eq("business_id", gate.businessId)
      .eq("id", id);
    if (error) return { ok: false, error: error.message };

    return { ok: true, view: toProviderView(def, { enabled, config: merged }) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed" };
  }
}

async function providerConfigForTest(
  businessId: string,
  id: string,
): Promise<Record<string, string> | { error: string }> {
  const api = admin();
  const { data } = await api
    .from("channel_providers")
    .select("config")
    .eq("business_id", businessId)
    .eq("id", id)
    .maybeSingle();
  const stored = (data?.config ?? {}) as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(stored)) {
    if (typeof v === "string") out[k] = v;
  }
  const def = PROVIDERS_BY_ID[id];
  const invalid = validateProviderConfig(def, out);
  if (invalid) return { error: `Save the credentials first — ${invalid}` };
  return out;
}

async function readError(res: Response, fallback: string): Promise<string> {
  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  const msg =
    (body?.message as string) ||
    ((body?.error as Record<string, unknown>)?.message as string) ||
    (body?.description as string);
  return msg || `${fallback} (${res.status})`;
}

// Tests the SAVED credentials (not unsaved form values — save first). For
// send-type providers, target is the address/number the caller typed; the
// content is fixed above. Verify-type providers ignore target.
export async function testProvider(
  id: string,
  target: string,
): Promise<ProviderTestResult> {
  const gate = await requireProvidersCaller();
  if (!gate.ok) return gate;
  const def = PROVIDERS_BY_ID[id];
  if (!def) return { ok: false, error: "Unknown provider" };

  try {
    const config = await providerConfigForTest(gate.businessId, id);
    if ("error" in config) return { ok: false, error: config.error };

    if (id === "resend") {
      const payload = buildResendPayload({
        from: config.from || DEFAULT_FROM,
        to: target,
        subject: "rice-mice test email",
        text: TEST_MESSAGE,
      });
      if ("error" in payload) return { ok: false, error: payload.error };
      const res = await fetch(RESEND_ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.api_key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      if (!res.ok) return { ok: false, error: await readError(res, "Resend error") };
      return { ok: true, detail: `Test email sent to ${payload.to[0]}` };
    }

    if (id === "whatsapp") {
      const payload = buildWhatsAppTemplatePayload(target);
      if ("error" in payload) return { ok: false, error: payload.error };
      const res = await fetch(whatsAppEndpoint(config.phone_number_id), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      if (!res.ok) return { ok: false, error: await readError(res, "WhatsApp error") };
      return { ok: true, detail: `hello_world template sent to +${payload.to}` };
    }

    if (id === "twilio_sms") {
      const params = buildTwilioSmsParams({
        from: config.from_number,
        to: target,
        body: TEST_MESSAGE,
      });
      if ("error" in params) return { ok: false, error: params.error };
      const res = await fetch(twilioEndpoint(config.account_sid), {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(
            `${config.account_sid}:${config.auth_token}`,
          ).toString("base64")}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams(params).toString(),
      });
      if (!res.ok) return { ok: false, error: await readError(res, "Twilio error") };
      return { ok: true, detail: `Test SMS sent to ${params.To}` };
    }

    if (id === "telegram") {
      const res = await fetch(telegramVerifyEndpoint(config.bot_token));
      const body = (await res.json().catch(() => null)) as {
        ok?: boolean;
        result?: { username?: string };
        description?: string;
      } | null;
      if (!res.ok || !body?.ok)
        return { ok: false, error: body?.description || `Telegram error (${res.status})` };
      return {
        ok: true,
        detail: `Token is valid — bot @${body.result?.username ?? "unknown"}`,
      };
    }

    if (id === "line") {
      const res = await fetch(LINE_VERIFY_ENDPOINT, {
        headers: { Authorization: `Bearer ${config.channel_access_token}` },
      });
      if (!res.ok) return { ok: false, error: await readError(res, "LINE error") };
      const body = (await res.json().catch(() => null)) as {
        displayName?: string;
      } | null;
      return {
        ok: true,
        detail: `Token is valid — account "${body?.displayName ?? "unknown"}"`,
      };
    }

    return { ok: false, error: "Unknown provider" };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Could not reach the provider",
    };
  }
}
