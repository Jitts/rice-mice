// SERVER ONLY — the database half of inbound WhatsApp (Sprint 61). Kept out of
// the route so the route stays a signature check, and out of lib/whatsappInbound
// so the routing and wording stay testable without a database.
//
// Two things are deliberately separate here:
//   RECORDING an inbound message always happens. It is the customer's own
//   words about their own account, and losing it would mean a shop cannot see
//   that someone asked to be left alone.
//   REPLYING happens only when the shop has switched auto-reply on. Every
//   outbound message in this codebase is a human decision; the switch in
//   Settings IS that decision, made once instead of per message.
//
// Acting on STOP is not gated on the switch. Honouring an opt-out is a legal
// obligation, not an engagement feature, and a shop that never turned replies
// on still has to stop messaging someone who asked it to.

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  DEFAULT_LOYALTY,
  basePoints,
  pointsByCustomer,
  withLoyaltyDefaults,
  type LoyaltyOrderRow,
  type Reward,
} from "@/lib/loyalty";
import { buildWhatsAppTextPayload, whatsAppEndpoint } from "@/lib/providers";
import {
  classify,
  collectInbound,
  replyText,
  unknownSenderReply,
  type Intent,
} from "@/lib/whatsappInbound";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://rice-mice.vercel.app";

type CustomerRow = {
  id: string;
  first_name: string | null;
  phone: string | null;
  whatsapp_opt_in: boolean;
};

async function sendText(
  accessToken: string,
  phoneNumberId: string,
  to: string,
  body: string,
): Promise<string | null> {
  const payload = buildWhatsAppTextPayload(to, body);
  if ("error" in payload) return null;
  try {
    const res = await fetch(whatsAppEndpoint(phoneNumberId), {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { messages?: { id?: string }[] };
    return json?.messages?.[0]?.id ?? null;
  } catch {
    return null;
  }
}

// Meta sends the sender as bare digits ("6581614958"); we store "+6581614958".
// Match on both rather than reformatting either, so a row saved before the
// Sprint 57 dial-code work still resolves.
async function findCustomer(
  admin: SupabaseClient,
  businessId: string,
  digits: string,
): Promise<CustomerRow | null> {
  const { data } = await admin
    .from("customers")
    .select("id, first_name, phone, whatsapp_opt_in")
    .eq("business_id", businessId)
    .in("phone", [`+${digits}`, digits])
    .limit(1);
  return (data?.[0] as CustomerRow) ?? null;
}

async function balanceFor(
  admin: SupabaseClient,
  businessId: string,
  customerId: string,
  loyalty: typeof DEFAULT_LOYALTY,
): Promise<number> {
  // One customer's orders, four columns — the same projection pointsByCustomer
  // documents as its minimum, so the number here cannot drift from the one
  // Reports shows.
  const { data } = await admin
    .from("orders")
    .select("customer_id, status, total_cents, reward_points_spent")
    .eq("business_id", businessId)
    .eq("customer_id", customerId);
  const rows = (data ?? []) as LoyaltyOrderRow[];
  if (rows.length === 0) return basePoints(loyalty).balance;
  return pointsByCustomer(rows, loyalty)[customerId]?.balance ?? basePoints(loyalty).balance;
}

export async function handleInbound(
  admin: SupabaseClient,
  args: { payload: unknown; businessId: string; config: Record<string, unknown> },
): Promise<number> {
  const messages = collectInbound(args.payload);
  if (messages.length === 0) return 0;

  const str = (k: string) =>
    typeof args.config[k] === "string" ? (args.config[k] as string).trim() : "";
  const accessToken = str("access_token");
  const phoneNumberId = str("phone_number_id");
  const autoReply = str("auto_reply") === "on" && !!accessToken && !!phoneNumberId;

  // Loaded once per callback, not once per message — Meta batches.
  const [{ data: business }, { data: rewardRows }] = await Promise.all([
    admin.from("businesses").select("*").eq("id", args.businessId).maybeSingle(),
    admin
      .from("rewards")
      .select("id, name, description, points_cost, benefit_type, benefit_value, active")
      .eq("business_id", args.businessId),
  ]);
  const loyalty = withLoyaltyDefaults(business ?? null);
  const rewards = (rewardRows ?? []) as Reward[];
  const shopName = String(business?.shop_name ?? business?.name ?? "us");
  const slug = typeof business?.slug === "string" ? business.slug : "";

  let handled = 0;
  for (const m of messages) {
    const intent = classify(m.text);
    const customer = await findCustomer(admin, args.businessId, m.from);

    // Consent changes are the one effect that lands whether or not replies are
    // switched on, and they land before the reply so the confirmation cannot
    // describe a state we failed to reach.
    if (customer && (intent === "stop" || intent === "start")) {
      await admin
        .from("customers")
        .update({ whatsapp_opt_in: intent === "start" })
        .eq("id", customer.id)
        .eq("business_id", args.businessId);
    }

    let reply: string | null = null;
    if (autoReply) {
      reply = customer
        ? replyText(intent, {
            shopName,
            firstName: customer.first_name,
            balance:
              intent === "balance"
                ? await balanceFor(admin, args.businessId, customer.id, loyalty)
                : 0,
            rewards,
            signupUrl: `${APP_URL}/s/${slug}`,
          })
        : unknownSenderReply(shopName, `${APP_URL}/s/${slug}`);
    }
    const sentId = reply ? await sendText(accessToken, phoneNumberId, m.from, reply) : null;

    await logInbound(admin, args.businessId, {
      intent,
      m,
      customerId: customer?.id ?? null,
      reply,
      sentId,
    });
    handled += 1;
  }
  return handled;
}

// ponytail: inbound lands in audit_log, which is a ledger and not a thread —
// there is no screen that reads it back as a conversation. Give it its own
// table the moment someone needs to scroll a customer's chat history; until
// then a new table would be a migration for a view nobody has asked for.
//
// The message text is stored verbatim because it is evidence of what a
// customer asked for. It is never re-read as an instruction: classify() only
// looks for four keywords, and the reply is built from stored facts.
async function logInbound(
  admin: SupabaseClient,
  businessId: string,
  d: {
    intent: Intent;
    m: { id: string; from: string; text: string };
    customerId: string | null;
    reply: string | null;
    sentId: string | null;
  },
) {
  await admin.from("audit_log").insert({
    business_id: businessId,
    actor: "customer",
    action: "whatsapp.inbound",
    target_id: d.customerId,
    payload_snapshot: {
      intent: d.intent,
      from: maskPhone(d.m.from),
      wamid: d.m.id,
      text: d.m.text.slice(0, 500),
      replied: !!d.sentId,
      reply: d.reply?.slice(0, 500) ?? null,
    },
    outcome: d.reply && !d.sentId ? "failed" : "success",
  });
}

// The audit log is readable by anyone with the Team permission, and a phone
// number is the one field in an inbound message that identifies a person to a
// reader who has no other business seeing it. The customer row it links to
// already carries the full number for anyone entitled to it.
function maskPhone(digits: string): string {
  return digits.length <= 4 ? digits : `••••${digits.slice(-4)}`;
}
