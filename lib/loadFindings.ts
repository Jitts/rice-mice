import type { SupabaseClient } from "@supabase/supabase-js";
import { withRuleDefaults, type MarketingRules } from "@/lib/marketing";
import { withLoyaltyDefaults, type Reward } from "@/lib/loyalty";
import { buildProfiles, type CustomerRow } from "@/lib/segments";
import {
  buildFindings,
  type Finding,
  type FindingCampaign,
  type FindingLog,
} from "@/lib/findings";
import type { Order } from "@/lib/orders";

// The one place that fetches the rows buildFindings needs and runs it. Shared
// by the Reports page and the dashboard nav badge (Sprint 37) so "what's
// notable" has a single source of truth — the badge count can never disagree
// with what Reports actually shows. Returns the raw rows too, so a caller
// that also needs them (Reports: orders table, copilot eval) doesn't re-fetch.
//
// ponytail: runs 5 queries on every call; the nav badge now pays this cost on
// every dashboard page load, not just Reports. Fine at one shop's data volume
// — if that ever measurably slows navigation, precompute on a schedule
// instead of live.
export type FindingsData = {
  findings: Finding[];
  orders: Order[];
  logs: FindingLog[];
  rules: MarketingRules;
};

export async function loadFindings(
  supabase: SupabaseClient,
  businessRow: Record<string, unknown> | null,
): Promise<FindingsData> {
  const [
    { data: orders },
    { data: customers },
    { data: campaigns },
    { data: logs },
    { data: rewards },
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
  ]);

  const orderRows = (orders ?? []) as Order[];
  const logRows = (logs ?? []) as FindingLog[];
  const rules = withRuleDefaults(businessRow);
  const findings = buildFindings({
    orders: orderRows,
    profiles: buildProfiles((customers ?? []) as CustomerRow[], orderRows),
    campaigns: (campaigns ?? []) as FindingCampaign[],
    logs: logRows,
    rules,
    loyalty: withLoyaltyDefaults(businessRow),
    rewards: (rewards ?? []) as Reward[],
  });

  return { findings, orders: orderRows, logs: logRows, rules };
}

// The nav badge only needs a count, and only for callers who could act on a
// proposal (same gate AgenticProposalPanel already applies).
export function countPendingProposals(findings: Finding[]): number {
  return findings.filter((f) => f.proposal).length;
}
