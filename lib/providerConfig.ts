// SERVER ONLY — reads channel provider credentials. channel_providers has RLS
// enabled with no policies, so the only way to it is the service-role client;
// keep this module out of client components (it would silently return nulls
// in the browser, but nothing here belongs there).

import { createAdminClient } from "@/lib/supabase/admin";
import {
  PROVIDERS,
  PROVIDERS_BY_ID,
  toProviderView,
  type ProviderId,
  type ProviderView,
} from "@/lib/providers";

type ProviderRow = {
  id: string;
  enabled: boolean;
  config: Record<string, unknown>;
};

// Raw config for one provider, or null when the row is missing, disabled, or
// the admin client isn't configured. Callers treat null as "provider off".
export async function getProviderConfig(
  id: ProviderId,
): Promise<Record<string, string> | null> {
  const admin = createAdminClient();
  if (!admin) return null;
  const { data } = await admin
    .from("channel_providers")
    .select("enabled, config")
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
export async function getResendConfig(): Promise<{
  apiKey: string;
  from: string | null;
} | null> {
  const db = await getProviderConfig("resend");
  if (db?.api_key?.trim()) {
    return { apiKey: db.api_key.trim(), from: db.from?.trim() || null };
  }
  const envKey = process.env.RESEND_API_KEY;
  if (envKey) return { apiKey: envKey, from: process.env.RESEND_FROM || null };
  return null;
}

// Drives whether the campaign/inbox UI shows direct-send buttons.
export async function emailProviderReady(): Promise<boolean> {
  return (await getResendConfig()) !== null;
}

// Masked views for the Settings page. Only call this AFTER verifying the
// caller holds the 'providers' permission — even masked values stay off the
// wire for everyone else.
export async function listProviderViews(): Promise<ProviderView[]> {
  const admin = createAdminClient();
  const rows: ProviderRow[] = [];
  if (admin) {
    const { data } = await admin
      .from("channel_providers")
      .select("id, enabled, config");
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
