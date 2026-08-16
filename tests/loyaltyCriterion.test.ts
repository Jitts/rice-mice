import { describe, it, expect } from "vitest";
import {
  FIELDS,
  buildProfiles,
  filterProfiles,
  profilesFromAggregate,
  type CustomerProfile,
  type CustomerRow,
  type SegmentDefinition,
} from "@/lib/segments";
import { DEFAULT_LOYALTY, earnedPoints, type LoyaltyConfig } from "@/lib/loyalty";
import type { Order } from "@/lib/orders";

// Sprint 54. Points are derived, never stored (DECISIONS Sprint 29 Q1), so this
// criterion recomputes them per evaluation from the profile plus the shop's
// rates. The rates are the part that can go wrong quietly.

const CONFIG: LoyaltyConfig = {
  ...DEFAULT_LOYALTY,
  points_per_order: 1,
  cents_per_point: 10000,
  signup_bonus_points: 0,
};

function customer(id: string): CustomerRow {
  return {
    id,
    first_name: "Test",
    last_name: id,
    phone: null,
    email: null,
    whatsapp_opt_in: false,
    email_opt_in: false,
    sms_opt_in: false,
    tags: [],
    birthday: null,
    created_at: "2026-01-01T00:00:00.000Z",
    last_purchase_date: null,
    unsubscribe_token: null,
    custom_fields: {},
  } as CustomerRow;
}

function order(o: Partial<Order> & { customer_id: string }): Order {
  return {
    id: `o-${Math.round(o.total_cents ?? 0)}-${o.customer_id}-${o.status ?? "completed"}`,
    order_no: 1,
    status: "completed",
    total_cents: 0,
    discount_cents: 0,
    payment_method: null,
    staff_name: null,
    campaign_id: null,
    reward_id: null,
    reward_points_spent: 0,
    created_at: "2026-06-01T00:00:00.000Z",
    order_items: [],
    ...o,
  } as Order;
}

const atLeast = (n: number): SegmentDefinition => ({
  type: "group",
  combinator: "all",
  children: [{ type: "condition", field: "loyalty_points", op: "gte", value: n }],
});

describe("loyalty_points criterion", () => {
  it("refuses to answer without the shop's loyalty settings", () => {
    // The whole reason this throws: falling back to DEFAULT_LOYALTY would give
    // confident numbers to a shop that has tuned its rates, and this criterion
    // decides who gets messaged. An empty segment would look like a real answer.
    const profiles = buildProfiles([customer("a")], []);
    expect(() => filterProfiles(atLeast(1), profiles, FIELDS, {})).toThrow(
      /loyalty settings/i,
    );
  });

  it("counts earned from completed orders and subtracts redemptions", () => {
    const orders: Order[] = [
      order({ customer_id: "a", total_cents: 20000 }), // 1 order + 2 spend pts
      order({ customer_id: "a", total_cents: 10000, reward_points_spent: 2 }),
    ];
    const [p] = buildProfiles([customer("a")], orders);
    // earned: 2 orders x1, plus floor(30000/10000)=3 → 5. spent 2 → balance 3.
    expect(earnedPoints(p.orderCount, p.totalSpentCents, CONFIG)).toBe(5);
    expect(p.rewardPointsSpent).toBe(2);

    const ctx = { loyalty: CONFIG };
    expect(filterProfiles(atLeast(3), [p], FIELDS, {}, ctx)).toHaveLength(1);
    expect(filterProfiles(atLeast(4), [p], FIELDS, {}, ctx)).toHaveLength(0);
  });

  it("counts a redemption on an OPEN order, and ignores a cancelled one", () => {
    // The filter that differs from every other aggregate column: an open order
    // has already reserved its points, and cancelling refunds them.
    const [open] = buildProfiles(
      [customer("a")],
      [order({ customer_id: "a", status: "open", reward_points_spent: 5 })],
    );
    expect(open.rewardPointsSpent).toBe(5);

    const [cancelled] = buildProfiles(
      [customer("b")],
      [order({ customer_id: "b", status: "cancelled", reward_points_spent: 5 })],
    );
    expect(cancelled.rewardPointsSpent).toBe(0);
  });

  it("gives the same answer from the aggregate as from raw orders", () => {
    // Segment membership must not depend on which page you happen to be on.
    const orders: Order[] = [
      order({ customer_id: "a", total_cents: 50000 }),
      order({ customer_id: "a", total_cents: 25000, reward_points_spent: 4 }),
      order({ customer_id: "a", status: "cancelled", total_cents: 90000, reward_points_spent: 9 }),
    ];
    const fromOrders = buildProfiles([customer("a")], orders);
    const fromAggregate = profilesFromAggregate(
      [customer("a")],
      [
        {
          customer_id: "a",
          order_count: 2,
          total_spent_cents: 75000,
          avg_order_cents: 37500,
          newest_completed_at: "2026-06-01T00:00:00.000Z",
          favourite_item: null,
          items_purchased: [],
          payment_methods: [],
          reward_points_spent: 4, // cancelled order's 9 excluded, matching SQL
        },
      ],
    );
    expect(fromAggregate[0].rewardPointsSpent).toBe(fromOrders[0].rewardPointsSpent);

    const ctx = { loyalty: CONFIG };
    for (const threshold of [1, 4, 5, 6]) {
      expect(filterProfiles(atLeast(threshold), fromOrders, FIELDS, {}, ctx).length).toBe(
        filterProfiles(atLeast(threshold), fromAggregate, FIELDS, {}, ctx).length,
      );
    }
  });

  it("reads bigint columns handed back as text", () => {
    // count()/sum() come back as strings from some client versions — the same
    // trap the other aggregate columns already guard against.
    const [p] = profilesFromAggregate(
      [customer("a")],
      [
        {
          customer_id: "a",
          order_count: "2",
          total_spent_cents: "75000",
          avg_order_cents: "37500",
          newest_completed_at: null,
          favourite_item: null,
          items_purchased: [],
          payment_methods: [],
          reward_points_spent: "4",
        },
      ],
    );
    expect(p.rewardPointsSpent).toBe(4);
  });

  it("treats a row from the pre-0028 shape as zero redemptions", () => {
    // A deploy where the migration has not landed yet must not crash; a shop
    // with no rewards has no redemptions anyway.
    const [p] = profilesFromAggregate(
      [customer("a")],
      [
        {
          customer_id: "a",
          order_count: 1,
          total_spent_cents: 10000,
          avg_order_cents: 10000,
          newest_completed_at: null,
          favourite_item: null,
          items_purchased: [],
          payment_methods: [],
        },
      ],
    );
    expect(p.rewardPointsSpent).toBe(0);
  });

  it("honours the shop's own rates rather than the defaults", () => {
    const generous: LoyaltyConfig = { ...CONFIG, points_per_order: 10 };
    const [p] = buildProfiles(
      [customer("a")],
      [order({ customer_id: "a", total_cents: 0 })],
    );
    expect(filterProfiles(atLeast(10), [p], FIELDS, {}, { loyalty: generous })).toHaveLength(1);
    expect(filterProfiles(atLeast(10), [p], FIELDS, {}, { loyalty: CONFIG })).toHaveLength(0);
  });

  it("supports over and under as well as at least", () => {
    const [p] = buildProfiles(
      [customer("a")],
      [order({ customer_id: "a", total_cents: 30000 })],
    );
    // 1 order + floor(30000/10000)=3 → 4 points.
    const ctx = { loyalty: CONFIG };
    const def = (op: string, value: number): SegmentDefinition => ({
      type: "group",
      combinator: "all",
      children: [{ type: "condition", field: "loyalty_points", op, value }],
    });
    expect(filterProfiles(def("gt", 3), [p], FIELDS, {}, ctx)).toHaveLength(1);
    expect(filterProfiles(def("gt", 4), [p], FIELDS, {}, ctx)).toHaveLength(0);
    expect(filterProfiles(def("lt", 5), [p], FIELDS, {}, ctx)).toHaveLength(1);
    expect(filterProfiles(def("lt", 4), [p], FIELDS, {}, ctx)).toHaveLength(0);
  });

  it("is offered in the picker like any other criterion", () => {
    const f: CustomerProfile[] = [];
    expect(f).toEqual([]);
    expect(FIELDS.loyalty_points.label).toBe("Loyalty points");
    expect(FIELDS.loyalty_points.operators.map((o) => o.id)).toEqual(["gte", "gt", "lt"]);
  });
});
