import { createClient } from "@/lib/supabase/server";
import { ReportsManager } from "@/components/ReportsManager";
import type { Order } from "@/lib/orders";
import { withRuleDefaults } from "@/lib/marketing";
import { withLoyaltyDefaults, type Reward } from "@/lib/loyalty";
import { buildProfiles, type CustomerRow } from "@/lib/segments";
import { buildFindings, type FindingCampaign, type FindingLog } from "@/lib/findings";
import { analystKeyEnvName, analystKeyPresent } from "@/lib/analystModel";

export const dynamic = "force-dynamic";

export default async function ReportsPage() {
  const supabase = await createClient();

  // Everything RLS-scoped to the caller's business. The findings engine
  // reuses the same rows the rest of the dashboard computes from.
  const [
    { data: orders },
    { data: customers },
    { data: campaigns },
    { data: logs },
    { data: rewards },
    { data: businessRow },
  ] = await Promise.all([
    supabase.from("orders").select("*, order_items(*)").order("created_at", { ascending: false }),
    supabase.from("customers").select("*"),
    supabase.from("campaigns").select("id, name"),
    supabase.from("engagement_logs").select("campaign_id, customer_id, sent_at"),
    supabase
      .from("rewards")
      .select("id, name, description, points_cost, benefit_type, benefit_value, active"),
    supabase.from("businesses").select("*").maybeSingle(),
  ]);

  const orderRows = (orders ?? []) as Order[];
  const findings = buildFindings({
    orders: orderRows,
    profiles: buildProfiles((customers ?? []) as CustomerRow[], orderRows),
    campaigns: (campaigns ?? []) as FindingCampaign[],
    logs: (logs ?? []) as FindingLog[],
    rules: withRuleDefaults(businessRow),
    loyalty: withLoyaltyDefaults(businessRow),
    rewards: (rewards ?? []) as Reward[],
  });

  return (
    <ReportsManager
      initialOrders={orderRows}
      findings={findings}
      analystReady={analystKeyPresent()}
      analystKeyName={analystKeyEnvName()}
    />
  );
}
