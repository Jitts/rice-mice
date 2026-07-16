"use server";

// Server-side send path for the SMS channel (Sprint 39) — mirrors
// app/actions/email.ts's campaign send exactly, swapped to Twilio. The staff
// click in the UI is still the send decision: this delivers the already-
// logged draft verbatim and re-checks consent HERE, server-side, so a client
// bug can never text an unsubscribed customer.

import { createClient } from "@/lib/supabase/server";
import { getTwilioConfig } from "@/lib/providerConfig";
import { buildTwilioSmsParams, twilioEndpoint } from "@/lib/providers";

export type SendResult = { ok: true } | { ok: false; error: string };

async function profileName(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from("staff_profiles")
    .select("display_name")
    .eq("id", userId)
    .maybeSingle();
  return data?.display_name ?? null;
}

// Server-side permission gate: the caller's membership role must include the
// campaigns permission (UI hiding is convenience; this is the enforcement).
async function callerSendContext(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
): Promise<{ businessId: string } | null> {
  const { data } = await supabase
    .from("memberships")
    .select("business_id, roles(permissions)")
    .eq("user_id", userId)
    .maybeSingle();
  const row = data as {
    business_id: string;
    roles: { permissions: string[] } | null;
  } | null;
  const perms = row?.roles?.permissions ?? [];
  if (!row || (!perms.includes("*") && !perms.includes("campaigns")))
    return null;
  return { businessId: row.business_id };
}

async function readError(res: Response, fallback: string): Promise<string> {
  const body = (await res.json().catch(() => null)) as { message?: string } | null;
  return body?.message || `${fallback} (${res.status})`;
}

async function deliver(businessId: string, to: string, text: string): Promise<SendResult> {
  const twilio = await getTwilioConfig(businessId);
  if (!twilio) return { ok: false, error: "SMS provider is not configured" };
  const params = buildTwilioSmsParams({ from: twilio.fromNumber, to, body: text });
  if ("error" in params) return { ok: false, error: params.error };
  try {
    const res = await fetch(twilioEndpoint(twilio.accountSid), {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${twilio.accountSid}:${twilio.authToken}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(params).toString(),
    });
    if (!res.ok) return { ok: false, error: await readError(res, "Twilio error") };
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not reach the SMS provider" };
  }
}

// Sends one campaign recipient's logged draft. Guards, in order: caller is
// signed-in staff, the row exists and is an unsent SMS row, and the customer
// STILL consents (live read, not the snapshot from approval time).
export async function sendCampaignSms(
  logId: string,
  staffName: string | null,
): Promise<SendResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in" };
  const ctx = await callerSendContext(supabase, user.id);
  if (!ctx)
    return { ok: false, error: "Your role doesn't include sending campaigns" };

  const { data: row } = await supabase
    .from("engagement_logs")
    .select("id, sent_at, channel, message_draft, customer_id, customers(phone, sms_opt_in)")
    .eq("id", logId)
    .single();
  const log = row as {
    id: string;
    sent_at: string | null;
    channel: string;
    message_draft: string;
    customer_id: string | null;
    customers: { phone: string | null; sms_opt_in: boolean } | null;
  } | null;

  if (!log) return { ok: false, error: "Recipient row not found" };
  if (log.sent_at) return { ok: false, error: "Already sent" };
  if (log.channel !== "sms") return { ok: false, error: "Not an SMS recipient" };
  const c = log.customers;
  if (!c?.sms_opt_in || !c.phone)
    return { ok: false, error: "Customer has unsubscribed or has no phone" };

  const sent = await deliver(ctx.businessId, c.phone, log.message_draft);
  if (!sent.ok) return sent;

  const by = staffName || (await profileName(supabase, user.id));
  const now = new Date().toISOString();
  await supabase
    .from("engagement_logs")
    .update({ sent_at: now, sent_by: by, sent_via: "twilio" })
    .eq("id", log.id);
  if (log.customer_id) {
    await supabase
      .from("customers")
      .update({ last_contacted_at: now })
      .eq("id", log.customer_id);
  }
  return { ok: true };
}
