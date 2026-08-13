import type { SupabaseClient } from "@supabase/supabase-js";
import { withRuleDefaults, type MarketingRules } from "@/lib/marketing";
import { withLoyaltyDefaults, type Reward } from "@/lib/loyalty";
import { buildProfiles, type CustomerRow } from "@/lib/segments";
import {
  buildFindings,
  type Finding,
  type FindingCampaign,
  type FindingJourney,
  type FindingLog,
} from "@/lib/findings";
import type { Order } from "@/lib/orders";

// The one place that fetches the rows buildFindings needs and runs it. Shared
// by the Reports page and the dashboard nav badge (Sprint 37) so "what's
// notable" has a single source of truth — the badge count can never disagree
// with what Reports actually shows. Returns the raw rows too, so a caller
// that also needs them (Reports: orders table, copilot eval) doesn't re-fetch.
//
// ponytail: two of its six queries are unbounded whole-table reads, so past
// 1,000 rows they truncate silently (Sprint 49) and every finding is computed
// from partial data — on every page under /dashboard, since the nav badge calls
// this from the layout. Upgrade: profiles come from customer_profile_aggregate
// (0026) and the raw orders read gets bounded to the widest window findings
// actually use — 30 days for the reports, attribution_window_days past the
// oldest campaign. Not a schedule: precomputing would just cache the wrong
// answers. Correct below 1,000 orders, which is where this shop still is.
//
// Superseded ceiling, kept as a warning: this said "5 queries" and named SPEED
// as the limit, with "precompute on a schedule" as the fix. Written Sprint 37,
// when that was true. Sprint 49 changed what the risk was and the comment did
// not move — a ponytail: ceiling is a claim about the future, so re-read it
// against what the codebase now knows, not just whether it has a trigger.
export type FindingsData = {
  findings: Finding[];
  orders: Order[];
  logs: FindingLog[];
  journeys: FindingJourney[];
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
    { data: journeys },
    { data: logs },
    { data: rewards },
  ] = await Promise.all([
    supabase.from("orders").select("*, order_items(*)").order("created_at", { ascending: false }),
    supabase.from("customers").select("*"),
    supabase.from("campaigns").select("id, name"),
    supabase.from("journeys").select("id, name"),
    supabase
      .from("engagement_logs")
      .select(
        "campaign_id, journey_id, customer_id, sent_at, message_draft_source, message_draft_review_status",
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

  return {
    findings,
    orders: orderRows,
    logs: logRows,
    journeys: (journeys ?? []) as FindingJourney[],
    rules,
  };
}

// The nav badge only needs a count, and only for callers who could act on a
// proposal (same gate AgenticProposalPanel already applies).
export function countPendingProposals(findings: Finding[]): number {
  return findings.filter((f) => f.proposal).length;
}
