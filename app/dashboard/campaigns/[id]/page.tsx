import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
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

  const [{ data: rows }, { data: orders }] = await Promise.all([
    supabase
      .from("engagement_logs")
      .select(
        "id, customer_id, channel, message_draft, sent_at, sent_by, outcome, customers(id, first_name, last_name, phone, email, whatsapp_opt_in, email_opt_in)",
      )
      .eq("campaign_id", id)
      .order("created_at"),
    supabase
      .from("orders")
      .select("customer_id, status, created_at, total_cents, campaign_id")
      .eq("status", "completed"),
  ]);

  return (
    <CampaignRun
      campaign={campaign as Campaign}
      initialRows={(rows ?? []) as unknown as RunRow[]}
      initialOrders={orders ?? []}
    />
  );
}
