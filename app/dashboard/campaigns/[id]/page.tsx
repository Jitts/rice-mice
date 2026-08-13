import type { AttributionOrder } from "@/lib/attribution";
import { readAll } from "@/lib/supabase/readAll";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { emailProviderReady, smsProviderReady, whatsappProviderReady } from "@/lib/providerConfig";
import { callerBusinessId } from "@/lib/tenant";
import { CampaignRun, type RunRow } from "@/components/CampaignRun";
import type { Campaign } from "@/lib/campaigns";

export const dynamic = "force-dynamic";

export default async function CampaignDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: campaign } = await supabase
    .from("campaigns")
    .select("*")
    .eq("id", id)
    .single();
  if (!campaign) notFound();

  const [{ data: rows }, ordersRead] = await Promise.all([
    supabase
      .from("engagement_logs")
      .select(
        "id, customer_id, channel, message_draft, sent_at, sent_by, outcome, customers(id, first_name, last_name, phone, email, whatsapp_opt_in, email_opt_in, sms_opt_in)",
      )
      .eq("campaign_id", id)
      .order("created_at"),
    // Attribution walks individual orders, so this cannot become the
    // per-customer aggregate — it can only stop truncating (Sprint 50).
    readAll<AttributionOrder>("of your completed orders", (from, to) =>
      supabase
        .from("orders")
        .select("customer_id, status, created_at, total_cents, campaign_id", { count: "exact" })
        .eq("status", "completed")
        .order("id")
        .range(from, to),
    ),
  ]);

  if (!ordersRead.ok) throw new Error(ordersRead.error);

  // Evaluated server-side; only the booleans reach the client.
  const businessId = await callerBusinessId();
  const [emailReady, smsReady, whatsappReady] = await Promise.all([
    emailProviderReady(businessId),
    smsProviderReady(businessId),
    whatsappProviderReady(businessId),
  ]);

  return (
    <CampaignRun
      campaign={campaign as Campaign}
      initialRows={(rows ?? []) as unknown as RunRow[]}
      initialOrders={ordersRead.rows}
      emailReady={emailReady}
      smsReady={smsReady}
      whatsappReady={whatsappReady}
    />
  );
}
