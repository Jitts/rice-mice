import type { SupabaseClient } from "@supabase/supabase-js";
import { withRuleDefaults, type MarketingRules } from "@/lib/marketing";
import { withLoyaltyDefaults, type Reward } from "@/lib/loyalty";
import {
  buildProfiles,
  stageOf,
  type CustomerProfile,
  type CustomerRow,
  type ProfileAggregateRow,
} from "@/lib/segments";
import {
  buildFindings,
  WIN_BACK_TAG,
  type Finding,
  type FindingCampaign,
  type FindingJourney,
  type FindingLog,
} from "@/lib/findings";
import type { Order } from "@/lib/orders";
import { readAll } from "@/lib/supabase/readAll";
import { buildSuggestions, type Suggestion } from "@/lib/suggestions";

// Only what the cheap badge count needs off a customer row.
type TagRow = { id: string; tags: string[] | null; last_purchase_date: string | null };

// The one place that fetches the rows buildFindings needs and runs it. Shared
// by the Reports page and the dashboard nav badge (Sprint 37) so "what's
// notable" has a single source of truth — the badge count can never disagree
// with what Reports actually shows. Returns the raw rows too, so a caller
// that also needs them (Reports: orders table, copilot eval) doesn't re-fetch.
//
// ponytail: two of its six queries are unbounded whole-table reads, so past
// 1,000 rows they truncate silently (Sprint 49) and every finding is computed
// from partial data — on every page under /dashboard, since the nav badge calls
// this from the layout. Now read through readAll, so a truncated read fails
// loudly instead of producing confident wrong findings.
//
// It still fetches every order, and it has to: buildReport windows them,
// attributeCampaign walks them individually, and pointsByCustomer needs
// LIFETIME totals including reward_points_spent, which customer_profile_aggregate
// does not carry. Windowing the read would understate every loyalty balance.
// Upgrade, if the payload rather than the correctness starts to hurt: add
// reward_points_spent to the aggregate and give buildReport its own windowed
// query. Not a schedule — precomputing would just cache whatever the reads got.
//
// Superseded ceiling, kept as a warning: this said "5 queries" and named SPEED
// as the limit, with "precompute on a schedule" as the fix. Written Sprint 37,
// when that was true. Sprint 49 changed what the risk was and the comment did
// not move — a ponytail: ceiling is a claim about the future, so re-read it
// against what the codebase now knows, not just whether it has a trigger.
export type FindingsData = {
  findings: Finding[];
  // Sprint 52: the cohort definitions a finding's campaign button needs. Built
  // from the profiles this function already has, so they cost no extra read.
  suggestions: Suggestion[];
  // Sprint 52: the create-audience dialog needs these to show its criteria
  // options and a live match count. Already built here for buildFindings, so
  // returning them costs nothing.
  profiles: CustomerProfile[];
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
    ordersRead,
    customersRead,
    { data: campaigns },
    { data: journeys },
    { data: logs },
    { data: rewards },
  ] = await Promise.all([
    readAll<Order>("of your orders", (from, to) =>
      supabase
        .from("orders")
        .select("*, order_items(*)", { count: "exact" })
        .order("created_at", { ascending: false })
        .order("id")
        .range(from, to),
    ),
    readAll<CustomerRow>("of your customers", (from, to) =>
      supabase.from("customers").select("*", { count: "exact" }).order("id").range(from, to),
    ),
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

  // Throws rather than reporting findings built from part of the shop. The one
  // caller that cannot afford to crash — the nav badge in the dashboard layout —
  // catches it and shows no badge.
  if (!ordersRead.ok) throw new Error(ordersRead.error);
  if (!customersRead.ok) throw new Error(customersRead.error);
  const orderRows = ordersRead.rows;
  const logRows = (logs ?? []) as FindingLog[];
  const rules = withRuleDefaults(businessRow);
  const loyalty = withLoyaltyDefaults(businessRow);
  const rewardRows = (rewards ?? []) as Reward[];
  const profiles = buildProfiles(customersRead.rows, orderRows);
  const findings = buildFindings({
    orders: orderRows,
    profiles,
    campaigns: (campaigns ?? []) as FindingCampaign[],
    logs: logRows,
    rules,
    loyalty,
    rewards: rewardRows,
  });

  return {
    findings,
    // Sprint 55: rewards + rates reach the suggestion builder so the redeemable
    // card gets a button. Same two values buildFindings just used, so the
    // suggestion and the finding cannot disagree about the threshold.
    suggestions: buildSuggestions(profiles, rules, new Date(), {
      rewards: rewardRows,
      loyalty,
    }),
    profiles,
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

// Sprint 56. The badge, without reading the orders table.
//
// It renders 0 or 1: `quiet_regulars` is the only finding that carries a
// proposal, so the question is just "is there at least one at-risk customer
// not already tagged win-back?". Answering it used to run the whole of
// loadFindings — every order WITH its order_items, plus every customer — from
// the dashboard LAYOUT, so it ran on Order pad, Menu items, Settings, Team,
// every navigation, to decide whether to draw a dot.
//
// customer_profile_aggregate already returns per-customer order counts and
// newest completed date, which is all `stageOf` needs. Two lean reads replace
// a full scan of the largest table in the shop.
//
// ponytail: still reads every customer row to check tags. Push the whole test
// into SQL if the customer table itself gets big — but customers grow far
// slower than order lines, and this is one narrow select rather than a join.
export async function countPendingProposalsCheaply(
  supabase: SupabaseClient,
  businessRow: Record<string, unknown> | null,
  businessId: string,
): Promise<number> {
  const rules = withRuleDefaults(businessRow);
  const [customersRead, aggregateRead] = await Promise.all([
    readAll<TagRow>("of your customers", (from, to) =>
      supabase
        .from("customers")
        .select("id, tags, last_purchase_date", { count: "exact" })
        .order("id")
        .range(from, to),
    ),
    readAll<ProfileAggregateRow>("of your customers' order history", (from, to) =>
      supabase
        .rpc("customer_profile_aggregate", { p_business: businessId }, { count: "exact" })
        .order("customer_id")
        .range(from, to),
    ),
  ]);
  if (!customersRead.ok) throw new Error(customersRead.error);
  if (!aggregateRead.ok) throw new Error(aggregateRead.error);

  const agg = new Map(aggregateRead.rows.map((r) => [r.customer_id, r]));
  for (const c of customersRead.rows) {
    if ((c.tags ?? []).includes(WIN_BACK_TAG)) continue;
    const a = agg.get(c.id);
    if (!a) continue;
    // Same inputs stageOf takes, and the same last-visit coalesce the profile
    // builders apply — so the badge cannot disagree with the Reports card.
    const stage = stageOf(
      {
        orderCount: Number(a.order_count) || 0,
        lastVisit: c.last_purchase_date ?? a.newest_completed_at ?? null,
      },
      rules,
    );
    if (stage === "at_risk") return 1;
  }
  return 0;
}
