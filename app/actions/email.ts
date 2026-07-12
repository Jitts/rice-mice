"use server";

// Server-side send path for the email channel. The staff click in the UI is
// still the send decision — these actions never run on a schedule and never
// compose anything: they deliver the already-logged draft verbatim (which
// includes the unsubscribe footer) and stamp the same bookkeeping the manual
// deep-link path stamps. Consent is re-checked HERE, server-side, so a client
// bug can never email an unsubscribed customer.

import { createClient } from "@/lib/supabase/server";
import {
  buildResendPayload,
  DEFAULT_FROM,
  RESEND_ENDPOINT,
} from "@/lib/email";

export type SendResult = { ok: true } | { ok: false; error: string };

// Who to stamp as the sender when the client didn't supply a name.
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

// Server-side permission gate: the caller's role must include the campaigns
// permission (UI hiding is convenience; this is the enforcement).
async function callerCanSend(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
): Promise<boolean> {
  const { data } = await supabase
    .from("staff_profiles")
    .select("roles(permissions)")
    .eq("id", userId)
    .maybeSingle();
  const perms =
    (data as { roles: { permissions: string[] } | null } | null)?.roles
      ?.permissions ?? [];
  return perms.includes("*") || perms.includes("campaigns");
}

async function deliver(
  to: string,
  subject: string | null,
  text: string,
): Promise<SendResult> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { ok: false, error: "Email provider is not configured" };
  const payload = buildResendPayload({
    from: process.env.RESEND_FROM || DEFAULT_FROM,
    to,
    subject,
    text,
  });
  if ("error" in payload) return { ok: false, error: payload.error };
  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as {
        message?: string;
      } | null;
      return {
        ok: false,
        error: body?.message || `Email provider error (${res.status})`,
      };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not reach the email provider" };
  }
}

// Sends one campaign recipient's logged draft. Guards, in order: caller is
// signed-in staff, the row exists and is an unsent email row, and the
// customer STILL consents (live read, not the snapshot from approval time).
export async function sendCampaignEmail(
  logId: string,
  staffName: string | null,
): Promise<SendResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in" };
  if (!(await callerCanSend(supabase, user.id)))
    return { ok: false, error: "Your role doesn't include sending campaigns" };

  const { data: row } = await supabase
    .from("engagement_logs")
    .select(
      "id, sent_at, channel, message_draft, customer_id, campaigns(subject), customers(email, email_opt_in)",
    )
    .eq("id", logId)
    .single();
  const log = row as {
    id: string;
    sent_at: string | null;
    channel: string;
    message_draft: string;
    customer_id: string | null;
    campaigns: { subject: string | null } | null;
    customers: { email: string | null; email_opt_in: boolean } | null;
  } | null;

  if (!log) return { ok: false, error: "Recipient row not found" };
  if (log.sent_at) return { ok: false, error: "Already sent" };
  if (log.channel !== "email")
    return { ok: false, error: "Not an email recipient" };
  const c = log.customers;
  if (!c?.email_opt_in || !c.email)
    return { ok: false, error: "Customer has unsubscribed or has no email" };

  const sent = await deliver(c.email, log.campaigns?.subject ?? null, log.message_draft);
  if (!sent.ok) return sent;

  const by = staffName || (await profileName(supabase, user.id));
  const now = new Date().toISOString();
  await supabase
    .from("engagement_logs")
    .update({ sent_at: now, sent_by: by, sent_via: "resend" })
    .eq("id", log.id);
  if (log.customer_id) {
    await supabase
      .from("customers")
      .update({ last_contacted_at: now })
      .eq("id", log.customer_id);
  }
  return { ok: true };
}

// Sends a journey-prepared draft from the action inbox and resolves the
// action, mirroring what ActionInbox.resolve("done") records for manual
// sends. Subject stays the generic default — journey names are internal
// working titles ("Win back lapsed VIPs"), not customer-facing copy.
export async function sendJourneyEmail(actionId: string): Promise<SendResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in" };
  if (!(await callerCanSend(supabase, user.id)))
    return { ok: false, error: "Your role doesn't include sending campaigns" };

  const { data: row } = await supabase
    .from("journey_actions")
    .select(
      "id, status, customer_id, journey_id, payload, customers(email, email_opt_in)",
    )
    .eq("id", actionId)
    .single();
  const action = row as {
    id: string;
    status: string;
    customer_id: string;
    journey_id: string;
    payload: { channel: string; body: string };
    customers: { email: string | null; email_opt_in: boolean } | null;
  } | null;

  if (!action) return { ok: false, error: "Draft not found" };
  if (action.status !== "pending")
    return { ok: false, error: "Already handled" };
  if (action.payload.channel !== "email")
    return { ok: false, error: "Not an email draft" };
  const c = action.customers;
  if (!c?.email_opt_in || !c.email)
    return { ok: false, error: "Customer has unsubscribed or has no email" };

  const sent = await deliver(c.email, null, action.payload.body);
  if (!sent.ok) return sent;

  const now = new Date().toISOString();
  await supabase
    .from("journey_actions")
    .update({ status: "done", acted_at: now })
    .eq("id", action.id);
  await supabase.from("engagement_logs").insert({
    customer_id: action.customer_id,
    journey_id: action.journey_id,
    channel: "email",
    message_draft: action.payload.body,
    message_draft_source: "journey",
    message_draft_review_status: "approved",
    sent_at: now,
    sent_via: "resend",
    sent_by: await profileName(supabase, user.id),
  });
  await supabase
    .from("customers")
    .update({ last_contacted_at: now })
    .eq("id", action.customer_id);
  return { ok: true };
}
