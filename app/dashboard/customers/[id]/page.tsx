import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Customer360, type Customer360Row } from "@/components/Customer360";
import type { Order } from "@/lib/orders";
import type { Reward } from "@/lib/loyalty";
import type {
  EngagementSendRow,
  SignupEventRow,
} from "@/lib/customer360";

export const dynamic = "force-dynamic";

// Customer 360 — everything the shop knows about one customer, composed from
// rows the other screens already read. Names for campaigns/journeys/rewards
// are fetched by id (no embed) so a missing FK never breaks the page.
export default async function CustomerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: customer } = await supabase
    .from("customers")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (!customer) notFound();

  const [
    { data: orders },
    { data: signupEvents },
    { data: sends },
    { data: rewards },
    { data: customFields },
  ] = await Promise.all([
    supabase
      .from("orders")
      .select("*, order_items(*)")
      .eq("customer_id", id)
      .order("created_at", { ascending: false }),
    supabase
      .from("signup_events")
      .select("created_at, source")
      .eq("customer_id", id)
      .order("created_at", { ascending: true }),
    supabase
      .from("engagement_logs")
      .select("id, sent_at, sent_by, channel, campaign_id, journey_id")
      .eq("customer_id", id)
      .order("sent_at", { ascending: false }),
    supabase
      .from("rewards")
      .select(
        "id, name, description, points_cost, benefit_type, benefit_value, active",
      )
      .order("points_cost"),
    supabase
      .from("custom_fields")
      .select("key, label, value_type")
      .order("sort_order"),
  ]);

  // Resolve display names for anything the logs/orders reference.
  const campaignIds = [
    ...new Set((sends ?? []).map((s) => s.campaign_id).filter(Boolean)),
  ] as string[];
  const journeyIds = [
    ...new Set((sends ?? []).map((s) => s.journey_id).filter(Boolean)),
  ] as string[];
  const rewardNames: Record<string, string> = {};
  for (const r of rewards ?? []) rewardNames[r.id] = r.name;

  const [campaignRows, journeyRows] = await Promise.all([
    campaignIds.length
      ? supabase.from("campaigns").select("id, name").in("id", campaignIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    journeyIds.length
      ? supabase.from("journeys").select("id, name").in("id", journeyIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
  ]);
  const campaignNames: Record<string, string> = {};
  for (const c of campaignRows.data ?? []) campaignNames[c.id] = c.name;
  const journeyNames: Record<string, string> = {};
  for (const j of journeyRows.data ?? []) journeyNames[j.id] = j.name;

  return (
    <Customer360
      initialCustomer={customer as Customer360Row}
      orders={(orders ?? []) as Order[]}
      signupEvents={(signupEvents ?? []) as SignupEventRow[]}
      sends={(sends ?? []) as EngagementSendRow[]}
      campaignNames={campaignNames}
      journeyNames={journeyNames}
      rewardNames={rewardNames}
      rewards={(rewards ?? []) as Reward[]}
      customFieldDefs={customFields ?? []}
    />
  );
}
