import { CURRENCY } from "@/lib/format";

// The loyalty engine. Pure and shared so the dashboard, order pad and rewards
// all agree on the same numbers. Points are never stored as a balance:
//  - earned  = derived from a customer's COMPLETED orders (the Sprint 5 rule)
//  - spent   = derived from reward redemptions on their NON-CANCELLED orders
//  - balance = earned − spent
// Cancelling an order therefore refunds both its earning and any redemption on
// it, with no bookkeeping to keep in sync.

export const POINTS_PER_ORDER = 1;
// 1 point per this many cents spent on completed orders ($100).
export const CENTS_PER_POINT = 10000;

export function earnedPoints(
  completedCount: number,
  completedSpendCents: number,
): number {
  return (
    completedCount * POINTS_PER_ORDER +
    Math.floor(completedSpendCents / CENTS_PER_POINT)
  );
}

export function pointsBalance(earned: number, spent: number): number {
  return earned - spent;
}

export type Reward = {
  id: string;
  name: string;
  description: string | null;
  points_cost: number;
  benefit_type: "percent" | "amount";
  benefit_value: number;
  active: boolean;
};

// The discount a reward takes off a cart, capped at the cart total — mirrors
// offerDiscountCents so rewards and campaign offers behave identically once
// applied.
export function rewardDiscountCents(
  reward: Pick<Reward, "benefit_type" | "benefit_value">,
  cartTotalCents: number,
): number {
  const raw =
    reward.benefit_type === "percent"
      ? Math.round((cartTotalCents * reward.benefit_value) / 100)
      : reward.benefit_value;
  return Math.max(0, Math.min(raw, cartTotalCents));
}

export function rewardBenefitLabel(
  reward: Pick<Reward, "benefit_type" | "benefit_value">,
): string {
  return reward.benefit_type === "percent"
    ? `${reward.benefit_value}% off`
    : `${CURRENCY}${(reward.benefit_value / 100).toFixed(2)} off`;
}

export function canAfford(
  balance: number,
  reward: Pick<Reward, "points_cost">,
): boolean {
  return balance >= reward.points_cost;
}

// Per-customer points, derived from a minimal order projection. `status` and
// the two money/points fields are all it needs, so callers can select just
// those columns.
export type LoyaltyOrderRow = {
  customer_id: string | null;
  status: string;
  total_cents: number | null;
  reward_points_spent: number | null;
};

export type CustomerPoints = { earned: number; spent: number; balance: number };

export function pointsByCustomer(
  orders: LoyaltyOrderRow[],
): Record<string, CustomerPoints> {
  const earnedAgg = new Map<string, { count: number; cents: number }>();
  const spent = new Map<string, number>();

  for (const o of orders) {
    if (!o.customer_id) continue;
    if (o.status === "completed") {
      const a = earnedAgg.get(o.customer_id) ?? { count: 0, cents: 0 };
      a.count += 1;
      a.cents += o.total_cents ?? 0;
      earnedAgg.set(o.customer_id, a);
    }
    // Any non-cancelled order's redemption counts as spent (open orders have
    // already reserved the points; cancelling refunds them).
    if (o.status !== "cancelled" && (o.reward_points_spent ?? 0) > 0) {
      spent.set(
        o.customer_id,
        (spent.get(o.customer_id) ?? 0) + (o.reward_points_spent ?? 0),
      );
    }
  }

  const out: Record<string, CustomerPoints> = {};
  const ids = new Set<string>([...earnedAgg.keys(), ...spent.keys()]);
  for (const id of ids) {
    const a = earnedAgg.get(id) ?? { count: 0, cents: 0 };
    const earned = earnedPoints(a.count, a.cents);
    const s = spent.get(id) ?? 0;
    out[id] = { earned, spent: s, balance: earned - s };
  }
  return out;
}
