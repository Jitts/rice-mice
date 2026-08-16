"use server";

// Server-side send path for WhatsApp campaigns via the Cloud API (Sprint 40)
// — mirrors app/actions/sms.ts, swapped to Meta's template send. Unlike
// email/SMS, the delivered text is NOT engagement_logs.message_draft: Meta
// only allows sending a business's pre-approved template, with the business's
// configured variables filled in from live customer/campaign data. The staff
// click in the UI is still the send decision; consent is re-checked HERE.

import { createClient } from "@/lib/supabase/server";
import { getWhatsAppConfig } from "@/lib/providerConfig";
import { buildWhatsAppTemplatePayload, whatsAppEndpoint } from "@/lib/providers";

export type SendResult =
  // Sprint 53: messageId is Meta's wamid, the only thing their delivery and
  // read callbacks key on. Optional because the manual (wa.me) path has no id
  // to report — nothing came back from an API, the staff member pressed send
  // in their own WhatsApp.
  { ok: true; messageId?: string } | { ok: false; error: string };

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
  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  const msg =
    (body?.message as string) || ((body?.error as Record<string, unknown>)?.message as string);
  return msg || `${fallback} (${res.status})`;
}

// Resolves one configured template variable name against live customer/offer
// data — the same merge tags the composer already offers (see renderTemplate
// in lib/campaigns.ts), just looked up individually instead of substituted
// into a body string.
function resolveVar(
  tag: string,
  c: { first_name: string; last_name: string },
  offerCode: string | null,
): string {
  if (tag === "name") return c.first_name;
  if (tag === "full_name") return `${c.first_name} ${c.last_name}`.trim();
  if (tag === "code") return offerCode ?? "";
  return "";
}

async function deliver(
  businessId: string,
  to: string,
  c: { first_name: string; last_name: string },
  offerCode: string | null,
): Promise<SendResult> {
  const wa = await getWhatsAppConfig(businessId);
  if (!wa) return { ok: false, error: "WhatsApp isn't connected with an approved template" };
  const params = wa.templateVars.map((tag) => resolveVar(tag, c, offerCode));
  const payload = buildWhatsAppTemplatePayload(to, wa.templateName, wa.templateLanguage, params);
  if ("error" in payload) return { ok: false, error: payload.error };
  try {
    const res = await fetch(whatsAppEndpoint(wa.phoneNumberId), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${wa.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) return { ok: false, error: await readError(res, "WhatsApp error") };
    // { messages: [{ id: "wamid.HBg..." }] }. A send that succeeded but whose
    // body we couldn't read is still a send — report ok without an id rather
    // than telling the user it failed and letting them send twice.
    let messageId: string | undefined;
    try {
      const body = (await res.json()) as { messages?: { id?: string }[] };
      messageId = body?.messages?.[0]?.id;
    } catch {
      messageId = undefined;
    }
    return { ok: true, messageId };
  } catch {
    return { ok: false, error: "Could not reach WhatsApp" };
  }
}

// Sends one campaign recipient via the business's approved template. Guards,
// in order: caller is signed-in staff, the row exists and is an unsent
// WhatsApp row, and the customer STILL consents (live read, not the snapshot
// from approval time).
export async function sendCampaignWhatsapp(
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
    .select(
      "id, sent_at, channel, customer_id, campaigns(offer_code), customers(phone, whatsapp_opt_in, first_name, last_name)",
    )
    .eq("id", logId)
    .single();
  const log = row as {
    id: string;
    sent_at: string | null;
    channel: string;
    customer_id: string | null;
    campaigns: { offer_code: string | null } | null;
    customers: {
      phone: string | null;
      whatsapp_opt_in: boolean;
      first_name: string;
      last_name: string;
    } | null;
  } | null;

  if (!log) return { ok: false, error: "Recipient row not found" };
  if (log.sent_at) return { ok: false, error: "Already sent" };
  if (log.channel !== "whatsapp") return { ok: false, error: "Not a WhatsApp recipient" };
  const c = log.customers;
  if (!c?.whatsapp_opt_in || !c.phone)
    return { ok: false, error: "Customer has unsubscribed or has no phone" };

  const sent = await deliver(ctx.businessId, c.phone, c, log.campaigns?.offer_code ?? null);
  if (!sent.ok) return sent;

  const by = staffName || (await profileName(supabase, user.id));
  const now = new Date().toISOString();
  await supabase
    .from("engagement_logs")
    .update({
      sent_at: now,
      sent_by: by,
      sent_via: "whatsapp",
      provider_message_id: sent.messageId ?? null,
    })
    .eq("id", log.id);
  if (log.customer_id) {
    await supabase
      .from("customers")
      .update({ last_contacted_at: now })
      .eq("id", log.customer_id);
  }
  return { ok: true };
}
