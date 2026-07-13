import { formatCents } from "@/lib/format";
import type { Order, OrderStatus } from "@/lib/orders";
import {
  canAfford,
  DEFAULT_LOYALTY,
  type LoyaltyConfig,
  type Reward,
} from "@/lib/loyalty";
import { channelDef, type CampaignChannel } from "@/lib/campaigns";

// Pure composition for the Customer 360 page: one customer's loyalty
// breakdown, reward progress, and activity timeline, all derived from rows
// the dashboard already knows how to load. No new sources of truth — the
// numbers here are the same engines' outputs, just arranged per-customer.

// --- loyalty breakdown ---------------------------------------------------

// Per-criterion split of one customer's points, so the 360 page can show WHY
// the balance is what it is. Sums to the same earned/spent/balance the order
// pad and dashboard compute.
export type LoyaltyBreakdown = {
  completedOrders: number;
  completedSpendCents: number;
  fromOrders: number;
  fromSpend: number;
  fromBonus: number;
  earned: number;
  spent: number;
  balance: number; // raw — may be negative after a rules change; floor for display
};

export function loyaltyBreakdown(
  orders: Pick<Order, "status" | "total_cents" | "reward_points_spent">[],
  config: LoyaltyConfig = DEFAULT_LOYALTY,
): LoyaltyBreakdown {
  let completedOrders = 0;
  let completedSpendCents = 0;
  let spent = 0;
  for (const o of orders) {
    if (o.status === "completed") {
      completedOrders += 1;
      completedSpendCents += o.total_cents ?? 0;
    }
    if (o.status !== "cancelled") spent += o.reward_points_spent ?? 0;
  }
  const fromOrders = completedOrders * config.points_per_order;
  const fromSpend =
    config.cents_per_point > 0
      ? Math.floor(completedSpendCents / config.cents_per_point)
      : 0;
  const fromBonus = config.signup_bonus_points;
  const earned = fromOrders + fromSpend + fromBonus;
  return {
    completedOrders,
    completedSpendCents,
    fromOrders,
    fromSpend,
    fromBonus,
    earned,
    spent,
    balance: earned - spent,
  };
}

// --- reward progress -------------------------------------------------------

// The cheapest reward they can redeem right now, and the cheapest one still
// out of reach (with how many points it needs). Either side can be null.
export type RewardProgress = {
  redeemableNow: Reward | null;
  next: { reward: Reward; needed: number } | null;
};

export function rewardProgress(
  rewards: Reward[],
  balance: number,
): RewardProgress {
  const active = rewards
    .filter((r) => r.active)
    .sort((a, b) => a.points_cost - b.points_cost);
  const spendable = Math.max(0, balance);
  const redeemableNow = active.find((r) => canAfford(spendable, r)) ?? null;
  const nextUp = active.find((r) => !canAfford(spendable, r)) ?? null;
  return {
    redeemableNow,
    next: nextUp
      ? { reward: nextUp, needed: nextUp.points_cost - spendable }
      : null,
  };
}

// --- activity timeline -------------------------------------------------------

export type SignupEventRow = {
  created_at: string;
  source: string | null;
};

export type EngagementSendRow = {
  id: string;
  sent_at: string | null;
  sent_by: string | null;
  channel: string;
  campaign_id: string | null;
  journey_id: string | null;
};

export type TimelineEvent = {
  at: string;
  kind: "signup" | "order" | "message";
  label: string;
  detail: string | null;
  href: string | null;
  status: OrderStatus | null; // set for orders, drives the status chip
};

function channelLabel(channel: string): string {
  try {
    return channelDef(channel as CampaignChannel)?.label ?? channel;
  } catch {
    return channel;
  }
}

// One chronological feed: signed up → ordered → messaged → redeemed. Newest
// first. Only concrete, timestamped events — derived states like "went at
// risk" have no timestamp and don't belong here.
export function buildTimeline(input: {
  customerCreatedAt: string;
  signupEvents: SignupEventRow[];
  orders: Order[];
  sends: EngagementSendRow[];
  campaignNames: Record<string, string>;
  journeyNames: Record<string, string>;
  rewardNames: Record<string, string>;
}): TimelineEvent[] {
  const events: TimelineEvent[] = [];

  const source = input.signupEvents[0]?.source ?? null;
  events.push({
    at: input.signupEvents[0]?.created_at ?? input.customerCreatedAt,
    kind: "signup",
    label: "Signed up",
    detail: source ? `via ${source}` : null,
    href: null,
    status: null,
  });

  for (const o of input.orders) {
    const parts: string[] = [];
    const lineCount = o.order_items?.reduce((n, l) => n + l.quantity, 0) ?? 0;
    if (lineCount > 0)
      parts.push(`${lineCount} item${lineCount === 1 ? "" : "s"}`);
    if ((o.reward_points_spent ?? 0) > 0) {
      const name = o.reward_id ? input.rewardNames[o.reward_id] : null;
      parts.push(
        `redeemed ${name ?? "a reward"} (−${o.reward_points_spent} pts)`,
      );
    } else if (o.campaign_id && (o.discount_cents ?? 0) > 0) {
      parts.push("offer code applied");
    }
    events.push({
      at: o.created_at,
      kind: "order",
      label: `Order #${o.order_no} — ${formatCents(o.total_cents)}`,
      detail: parts.join(" · ") || null,
      href: `/dashboard/orders/${o.id}`,
      status: o.status,
    });
  }

  for (const s of input.sends) {
    if (!s.sent_at) continue; // drafts/pending rows aren't activity yet
    const name =
      (s.campaign_id && input.campaignNames[s.campaign_id]) ||
      (s.journey_id && input.journeyNames[s.journey_id]) ||
      null;
    events.push({
      at: s.sent_at,
      kind: "message",
      label: `${channelLabel(s.channel)} message sent`,
      detail:
        [name, s.sent_by ? `by ${s.sent_by}` : null]
          .filter(Boolean)
          .join(" · ") || null,
      href: null,
      status: null,
    });
  }

  return events.sort(
    (a, b) => new Date(b.at).getTime() - new Date(a.at).getTime(),
  );
}
