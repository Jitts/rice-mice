import { buildReport, presetRange, startOfDay } from "@/lib/reports";
import { formatCents } from "@/lib/format";
import type { Order } from "@/lib/orders";
import { isReachable, stageOf, type CustomerProfile } from "@/lib/segments";
import { DEFAULT_RULES, type MarketingRules } from "@/lib/marketing";
import {
  basePoints,
  canAfford,
  pointsByCustomer,
  DEFAULT_LOYALTY,
  type LoyaltyConfig,
  type Reward,
} from "@/lib/loyalty";
import { attributeCampaign } from "@/lib/attribution";
import type { AgenticProposal } from "@/lib/agentic";

// Notable findings: the deterministic checks behind the Reports page's
// findings cards. Every number in a finding is computed here, from the same
// engines the rest of the app uses (buildReport, stageOf, pointsByCustomer,
// attributeCampaign) — the analyst chat narrates these facts, it never
// invents them. Pure and clock-injectable so the whole set is testable.

export type FindingTone = "warn" | "good" | "info";

export type Receipt = {
  label: string;
  value: string;
  href?: string; // deep link to the screen that shows this number
};

export type Finding = {
  id: string;
  tone: FindingTone;
  title: string;
  body: string; // deterministic template — every figure comes from the checks
  receipts: Receipt[];
  action?: { label: string; href: string };
  // An optional agent action a human can review + approve on this finding. The
  // targets are computed here (never invented), so the executor only ever acts
  // on the exact customers the deterministic check identified.
  proposal?: AgenticProposal;
};

export type FindingCampaign = { id: string; name: string };

export type FindingLog = {
  campaign_id: string | null;
  customer_id: string | null;
  sent_at: string | null;
};

export type FindingsInput = {
  orders: Order[];
  profiles: CustomerProfile[];
  campaigns: FindingCampaign[];
  logs: FindingLog[];
  rules?: MarketingRules;
  loyalty?: LoyaltyConfig;
  rewards?: Reward[];
  now?: Date;
};

const DAY_MS = 24 * 60 * 60 * 1000;

// The tag the "quiet regulars" finding proposes applying. A stable slug so the
// same audience can later be segmented/filtered on it.
export const WIN_BACK_TAG = "win-back";

function daysBack(from: number, to: number, now: Date) {
  const today = startOfDay(now);
  const day = (n: number) =>
    new Date(today.getFullYear(), today.getMonth(), today.getDate() - n);
  return { from: day(from), to: day(to) };
}

function pct(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 100);
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

const TONE_RANK: Record<FindingTone, number> = { warn: 0, good: 1, info: 2 };
const MAX_FINDINGS = 6;

export function buildFindings({
  orders,
  profiles,
  campaigns,
  logs,
  rules = DEFAULT_RULES,
  loyalty = DEFAULT_LOYALTY,
  rewards = [],
  now = new Date(),
}: FindingsInput): Finding[] {
  const findings: Finding[] = [];

  // --- Revenue trend: last 7 days vs the 7 before ---------------------------
  const thisWeek = buildReport(orders, daysBack(6, 0, now));
  const lastWeek = buildReport(orders, daysBack(13, 7, now));
  if (thisWeek.completedCount > 0 || lastWeek.completedCount > 0) {
    const diff = thisWeek.revenueCents - lastWeek.revenueCents;
    const change = pct(Math.abs(diff), lastWeek.revenueCents);
    let tone: FindingTone = "info";
    let title = "Revenue is steady week on week";
    let body = `The last 7 days brought in ${formatCents(thisWeek.revenueCents)} across ${plural(thisWeek.completedCount, "completed order")}, close to the ${formatCents(lastWeek.revenueCents)} of the 7 days before.`;
    if (lastWeek.revenueCents === 0 && thisWeek.revenueCents > 0) {
      tone = "good";
      title = "Revenue restarted this week";
      body = `The last 7 days brought in ${formatCents(thisWeek.revenueCents)} across ${plural(thisWeek.completedCount, "completed order")}, after a quiet previous week.`;
    } else if (diff < 0 && change >= 15) {
      tone = "warn";
      title = `Revenue is down ${change}% week on week`;
      body = `The last 7 days brought in ${formatCents(thisWeek.revenueCents)} (${plural(thisWeek.completedCount, "order")}), down from ${formatCents(lastWeek.revenueCents)} (${plural(lastWeek.completedCount, "order")}) in the 7 days before.`;
    } else if (diff > 0 && change >= 15) {
      tone = "good";
      title = `Revenue is up ${change}% week on week`;
      body = `The last 7 days brought in ${formatCents(thisWeek.revenueCents)} (${plural(thisWeek.completedCount, "order")}), up from ${formatCents(lastWeek.revenueCents)} (${plural(lastWeek.completedCount, "order")}) in the 7 days before.`;
    }
    findings.push({
      id: "revenue_trend",
      tone,
      title,
      body,
      receipts: [
        { label: "Last 7 days", value: formatCents(thisWeek.revenueCents) },
        { label: "Previous 7", value: formatCents(lastWeek.revenueCents) },
        { label: "Avg order", value: formatCents(thisWeek.avgOrderCents) },
      ],
    });
  }

  // --- Quiet regulars: customers the rules call "at risk" -------------------
  const atRisk = profiles.filter((p) => stageOf(p, rules) === "at_risk");
  if (atRisk.length > 0) {
    const reachable = atRisk.filter(isReachable).length;
    const top = [...atRisk]
      .sort((a, b) => b.totalSpentCents - a.totalSpentCents)
      .slice(0, 3);
    // Only propose tagging the ones NOT already tagged "win-back" — approving
    // twice shouldn't re-flag anyone, and the count the human sees is the real
    // number of changes.
    const untagged = atRisk.filter(
      (p) => !(p.tags ?? []).includes(WIN_BACK_TAG),
    );
    findings.push({
      id: "quiet_regulars",
      tone: "warn",
      title: `${plural(atRisk.length, "customer")} with order history ${atRisk.length === 1 ? "has" : "have"} gone quiet`,
      body: `${plural(atRisk.length, "customer")} who ordered before ${atRisk.length === 1 ? "hasn't" : "haven't"} visited in over ${rules.at_risk_days} days (your at-risk threshold). ${reachable} of them opted in to marketing, so a win-back campaign can reach them.`,
      receipts: top.map((p) => ({
        label: `${p.firstName} ${p.lastName}`.trim(),
        value: `${formatCents(p.totalSpentCents)} lifetime`,
        href: `/dashboard/customers/${p.id}`,
      })),
      action: { label: "Start a win-back campaign", href: "/dashboard/campaigns" },
      proposal:
        untagged.length > 0
          ? {
              type: "tag.apply",
              tag: WIN_BACK_TAG,
              targets: untagged.map((p) => ({
                id: p.id,
                name: `${p.firstName} ${p.lastName}`.trim() || "Customer",
              })),
            }
          : undefined,
    });
  }

  // --- Campaign attribution: best performer + campaigns nobody returned from -
  const campaignLogs = logs.filter((l) => l.campaign_id);
  const nowMs = now.getTime();
  let best: { name: string; id: string; sent: number; returned: number; cents: number } | null = null;
  for (const c of campaigns) {
    const own = campaignLogs.filter((l) => l.campaign_id === c.id);
    if (own.length === 0) continue;
    const result = attributeCampaign(own, orders, rules.attribution_window_days, c.id);
    if (result.sentCount === 0) continue;
    const totalCents = result.attributedCents + result.redeemedCents;
    if (totalCents > 0 && (!best || totalCents > best.cents)) {
      best = {
        name: c.name,
        id: c.id,
        sent: result.sentCount,
        returned: result.returnedCount,
        cents: totalCents,
      };
    }
    // "No one came back" is only fair once the attribution window has fully
    // elapsed since the last send — and only for reasonably recent campaigns.
    const lastSent = own.reduce(
      (max, l) => Math.max(max, l.sent_at ? new Date(l.sent_at).getTime() : 0),
      0,
    );
    const daysSinceSend = (nowMs - lastSent) / DAY_MS;
    if (
      result.sentCount >= 5 &&
      result.returnedCount === 0 &&
      result.redeemedCount === 0 &&
      daysSinceSend >= rules.attribution_window_days &&
      daysSinceSend <= 90
    ) {
      findings.push({
        id: `campaign_no_return_${c.id}`,
        tone: "warn",
        title: `"${c.name}" hasn't brought anyone back`,
        body: `${plural(result.sentCount, "message")} went out, and no recipient has placed a completed order in the ${rules.attribution_window_days}-day window since. Worth revisiting the offer or the audience.`,
        receipts: [
          { label: "Sent", value: String(result.sentCount), href: `/dashboard/campaigns/${c.id}` },
          { label: "Returned", value: "0" },
        ],
        action: { label: "Review campaign", href: `/dashboard/campaigns/${c.id}` },
      });
    }
  }
  if (best) {
    findings.push({
      id: "best_campaign",
      tone: "good",
      title: `"${best.name}" is your best-earning campaign`,
      body: `${best.returned} of ${plural(best.sent, "recipient")} came back within ${rules.attribution_window_days} days of their send, spending ${formatCents(best.cents)} (post-send revenue plus offer-code redemptions — not a causal claim).`,
      receipts: [
        { label: "Post-send revenue", value: formatCents(best.cents), href: `/dashboard/campaigns/${best.id}` },
        { label: "Came back", value: `${best.returned}/${best.sent}` },
      ],
      action: { label: "Open campaign", href: `/dashboard/campaigns/${best.id}` },
    });
  }

  // --- New sign-ups who never ordered ---------------------------------------
  const idleNewcomers = profiles.filter((p) => {
    if (p.orderCount !== 0) return false;
    const days = (nowMs - new Date(p.createdAt).getTime()) / DAY_MS;
    return days <= 30;
  });
  if (idleNewcomers.length > 0) {
    findings.push({
      id: "idle_newcomers",
      tone: "info",
      title: `${plural(idleNewcomers.length, "new sign-up")} ${idleNewcomers.length === 1 ? "hasn't" : "haven't"} ordered yet`,
      body: `${plural(idleNewcomers.length, "customer")} joined in the last 30 days without placing an order. A welcome nudge converts these while the visit is still fresh.`,
      receipts: [
        {
          label: "Reachable",
          value: `${idleNewcomers.filter(isReachable).length} of ${idleNewcomers.length}`,
        },
      ],
      action: { label: "Send a welcome campaign", href: "/dashboard/campaigns" },
    });
  }

  // --- Customers who can already redeem a reward -----------------------------
  const activeRewards = rewards
    .filter((r) => r.active)
    .sort((a, b) => a.points_cost - b.points_cost);
  const cheapest = activeRewards[0];
  if (cheapest) {
    const points = pointsByCustomer(orders, loyalty);
    const fallback = basePoints(loyalty);
    const redeemable = profiles.filter((p) =>
      canAfford((points[p.id] ?? fallback).balance, cheapest),
    );
    if (redeemable.length > 0) {
      findings.push({
        id: "redeemable_rewards",
        tone: "info",
        title: `${plural(redeemable.length, "customer")} can already redeem "${cheapest.name}"`,
        body: `${plural(redeemable.length, "customer")} hold at least ${cheapest.points_cost} points — enough for ${cheapest.name}. Reminding them gives a concrete reason to come back.`,
        receipts: [
          { label: "Reward", value: `${cheapest.name} (${cheapest.points_cost} pts)` },
          { label: "Eligible", value: String(redeemable.length) },
        ],
        action: { label: "Nudge them with a campaign", href: "/dashboard/campaigns" },
      });
    }
  }

  // --- Last-30-day health checks: discounts, cancellations, item mix --------
  const month = buildReport(orders, presetRange("last30", now));
  const grossCents = month.revenueCents + month.discountCents;
  if (month.revenueCents > 0 && pct(month.discountCents, grossCents) >= 15) {
    findings.push({
      id: "discount_share",
      tone: "warn",
      title: `Discounts took ${pct(month.discountCents, grossCents)}% off gross sales this month`,
      body: `Over the last 30 days, ${formatCents(month.discountCents)} was given away in discounts against ${formatCents(month.revenueCents)} of collected revenue. Check whether offers and rewards are set deeper than intended.`,
      receipts: [
        { label: "Discounts (30d)", value: formatCents(month.discountCents) },
        { label: "Revenue (30d)", value: formatCents(month.revenueCents) },
      ],
      action: { label: "Review rewards & offers", href: "/dashboard/settings" },
    });
  }
  const monthOrderCount = month.completedCount + month.cancelledCount;
  if (month.cancelledCount >= 3 && pct(month.cancelledCount, monthOrderCount) >= 15) {
    findings.push({
      id: "cancellation_rate",
      tone: "warn",
      title: `${pct(month.cancelledCount, monthOrderCount)}% of orders were cancelled this month`,
      body: `${plural(month.cancelledCount, "order")} out of ${monthOrderCount} finished orders in the last 30 days ended cancelled. Cancelled orders earn no revenue and no loyalty points.`,
      receipts: [
        { label: "Cancelled (30d)", value: String(month.cancelledCount), href: "/dashboard/orders" },
        { label: "Completed (30d)", value: String(month.completedCount) },
      ],
    });
  }
  if (month.byItem.length >= 2) {
    const top = month.byItem[0];
    const grossItems = month.byItem.reduce((s, i) => s + i.grossCents, 0);
    const share = pct(top.grossCents, grossItems);
    if (share >= 40) {
      findings.push({
        id: "top_item_concentration",
        tone: "info",
        title: `${top.name} drives ${share}% of item sales`,
        body: `Over the last 30 days, ${top.name} sold ${top.quantity} units for ${formatCents(top.grossCents)} gross — ${share}% of all item sales. Menu and stock decisions should keep this anchor in mind.`,
        receipts: [
          { label: top.name, value: `${top.quantity} sold` },
          { label: "Gross (30d)", value: formatCents(top.grossCents) },
        ],
      });
    }
  }

  return findings
    .sort((a, b) => TONE_RANK[a.tone] - TONE_RANK[b.tone])
    .slice(0, MAX_FINDINGS);
}
