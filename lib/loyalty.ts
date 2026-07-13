import { CURRENCY } from "@/lib/format";

// The loyalty engine. Pure and shared so the dashboard, order pad and rewards
// all agree on the same numbers. Points are never stored as a balance:
//  - earned  = derived from a customer's COMPLETED orders + the welcome bonus
//  - spent   = derived from reward redemptions on their NON-CANCELLED orders
//  - balance = earned − spent
// Cancelling an order therefore refunds both its earning and any redemption on
// it, with no bookkeeping to keep in sync. The earning criteria are editable
// in Settings (LoyaltyConfig below); because points are derived, editing them
// re-scores every customer retroactively.

export const POINTS_PER_ORDER = 1;
// 1 point per this many cents spent on completed orders ($100).
export const CENTS_PER_POINT = 10000;

// The earning criteria, editable in Settings → Loyalty earning. A value of 0
// switches that criterion off. Stored on the business_settings singleton
// (columns prefixed loyalty_); every consumer falls back to DEFAULT_LOYALTY,
// so a missing row can never change behaviour.
export type LoyaltyConfig = {
  points_per_order: number;
  // Cents a customer must spend (on completed orders) to earn 1 point.
  cents_per_point: number;
  // Flat points every customer has just for signing up.
  signup_bonus_points: number;
};

export const DEFAULT_LOYALTY: LoyaltyConfig = {
  points_per_order: POINTS_PER_ORDER,
  cents_per_point: CENTS_PER_POINT,
  signup_bonus_points: 0,
};

const LOYALTY_COLUMNS: Record<keyof LoyaltyConfig, string> = {
  points_per_order: "loyalty_points_per_order",
  cents_per_point: "loyalty_cents_per_point",
  signup_bonus_points: "loyalty_signup_bonus_points",
};

function toNonNegativeInt(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return null;
  const i = Math.round(n);
  return i >= 0 ? i : null;
}

export function withLoyaltyDefaults(
  row: Record<string, unknown> | null | undefined,
): LoyaltyConfig {
  const config = { ...DEFAULT_LOYALTY };
  for (const key of Object.keys(LOYALTY_COLUMNS) as (keyof LoyaltyConfig)[]) {
    const v = toNonNegativeInt(row?.[LOYALTY_COLUMNS[key]]);
    if (v !== null) config[key] = v;
  }
  return config;
}

// The business_settings column payload for a Settings save.
export function loyaltyColumns(config: LoyaltyConfig): Record<string, number> {
  return {
    loyalty_points_per_order: config.points_per_order,
    loyalty_cents_per_point: config.cents_per_point,
    loyalty_signup_bonus_points: config.signup_bonus_points,
  };
}

// Cross-field sanity for the Settings form; the DB checks are the backstop.
export function validateLoyalty(config: LoyaltyConfig): string | null {
  const { points_per_order, cents_per_point, signup_bonus_points } = config;
  if (
    !Number.isInteger(points_per_order) ||
    points_per_order < 0 ||
    points_per_order > 1000
  )
    return "Points per completed order must be a whole number between 0 and 1000";
  if (
    !Number.isInteger(cents_per_point) ||
    cents_per_point < 0 ||
    cents_per_point > 100000000
  )
    return "Spend per point must be between $1 and $1,000,000 (or 0 to switch spend earning off)";
  if (cents_per_point > 0 && cents_per_point < 100)
    return "Spend per point must be at least $1 (or 0 to switch spend earning off)";
  if (
    !Number.isInteger(signup_bonus_points) ||
    signup_bonus_points < 0 ||
    signup_bonus_points > 1000
  )
    return "The welcome bonus must be a whole number between 0 and 1000";
  if (points_per_order === 0 && cents_per_point === 0 && signup_bonus_points === 0)
    return "At least one way to earn points must stay on — otherwise rewards can never be redeemed";
  return null;
}

function pts(n: number): string {
  return n === 1 ? "1 point" : `${n} points`;
}

function dollars(cents: number): string {
  const d = cents / 100;
  return Number.isInteger(d) ? String(d) : d.toFixed(2);
}

// Plain-English rendering of the earning criteria. The glossary, Settings and
// tooltips all quote this one function, so what the app *says* about earning
// can never drift from what the engine *does*. Returns a lowercase phrase
// with no trailing period, e.g. "1 point per completed order, plus 1 point
// per $100 spent".
export function earningRuleText(
  config: LoyaltyConfig = DEFAULT_LOYALTY,
): string {
  const parts: string[] = [];
  if (config.points_per_order > 0)
    parts.push(`${pts(config.points_per_order)} per completed order`);
  if (config.cents_per_point > 0)
    parts.push(`1 point per ${CURRENCY}${dollars(config.cents_per_point)} spent`);
  if (config.signup_bonus_points > 0)
    parts.push(
      `a ${config.signup_bonus_points}-point welcome bonus just for signing up`,
    );
  if (parts.length === 0) return "point earning is currently switched off";
  return parts.join(", plus ");
}

export function earnedPoints(
  completedCount: number,
  completedSpendCents: number,
  config: LoyaltyConfig = DEFAULT_LOYALTY,
): number {
  return (
    completedCount * config.points_per_order +
    (config.cents_per_point > 0
      ? Math.floor(completedSpendCents / config.cents_per_point)
      : 0) +
    config.signup_bonus_points
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

// What a customer with no order history holds — the welcome bonus, if any.
// Callers use this as the fallback for customers absent from pointsByCustomer.
export function basePoints(
  config: LoyaltyConfig = DEFAULT_LOYALTY,
): CustomerPoints {
  return {
    earned: config.signup_bonus_points,
    spent: 0,
    balance: config.signup_bonus_points,
  };
}

export function pointsByCustomer(
  orders: LoyaltyOrderRow[],
  config: LoyaltyConfig = DEFAULT_LOYALTY,
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
    const earned = earnedPoints(a.count, a.cents, config);
    const s = spent.get(id) ?? 0;
    out[id] = { earned, spent: s, balance: earned - s };
  }
  return out;
}
