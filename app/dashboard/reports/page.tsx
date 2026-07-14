import { createClient } from "@/lib/supabase/server";
import { ReportsManager } from "@/components/ReportsManager";
import type { Order } from "@/lib/orders";
import { withRuleDefaults } from "@/lib/marketing";
import { withLoyaltyDefaults, type Reward } from "@/lib/loyalty";
import { buildProfiles, type CustomerRow } from "@/lib/segments";
import { buildFindings, type FindingCampaign, type FindingLog } from "@/lib/findings";
import { analystKeyEnvName, analystKeyPresent } from "@/lib/analystModel";
import { buildCopilotEval, type CopilotLog } from "@/lib/copilotEval";
import { can } from "@/lib/permissions";

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
    supabase
      .from("engagement_logs")
      .select(
        "campaign_id, customer_id, sent_at, message_draft_source, message_draft_review_status",
      ),
    supabase
      .from("rewards")
      .select("id, name, description, points_cost, benefit_type, benefit_value, active"),
    supabase.from("businesses").select("*").maybeSingle(),
  ]);

  // Can this caller apply the assistant's proposed tag changes? Same gate as
  // the manual tag editor — the `customers` permission. Self lookup (RLS shows
  // the whole roster, so filter to this user).
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: membershipRow } = user
    ? await supabase
        .from("memberships")
        .select("roles(permissions)")
        .eq("user_id", user.id)
        .maybeSingle()
    : { data: null };
  const perms = (membershipRow as { roles: { permissions: string[] } | null } | null)
    ?.roles?.permissions;
  const canApplyTags = can(perms, "customers");

  const orderRows = (orders ?? []) as Order[];
  const rules = withRuleDefaults(businessRow);
  const findings = buildFindings({
    orders: orderRows,
    profiles: buildProfiles((customers ?? []) as CustomerRow[], orderRows),
    campaigns: (campaigns ?? []) as FindingCampaign[],
    logs: (logs ?? []) as FindingLog[],
    rules,
    loyalty: withLoyaltyDefaults(businessRow),
    rewards: (rewards ?? []) as Reward[],
  });

  const copilotEval = buildCopilotEval({
    logs: (logs ?? []) as CopilotLog[],
    orders: orderRows,
    windowDays: rules.attribution_window_days,
  });

  return (
    <ReportsManager
      initialOrders={orderRows}
      findings={findings}
      copilotEval={copilotEval}
      analystReady={analystKeyPresent()}
      analystKeyName={analystKeyEnvName()}
      canApplyTags={canApplyTags}
    />
  );
}
