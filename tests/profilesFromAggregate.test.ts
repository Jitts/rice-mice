import { describe, it, expect } from "vitest";
import { buildProfiles, profilesFromAggregate, type CustomerRow } from "@/lib/segments";
import type { Order } from "@/lib/orders";

// Sprint 50. profilesFromAggregate is the second entry point into the same
// profiles: given the per-customer roll-up from migration 0026 instead of every
// order row, it must produce byte-identical CustomerProfiles.
//
// tests/profileAggregate.parity.test.ts proves the SQL agrees with
// buildProfiles, but only when a dump exists. This proves the TypeScript side
// unconditionally, so a change to either path fails here on every `npm test`.

const customer = (over: Partial<CustomerRow> = {}): CustomerRow =>
  ({
    id: "c1",
    first_name: "Amara",
    last_name: "Okafor",
    phone: "6591234567",
    email: "amara@example.com",
    whatsapp_opt_in: true,
    email_opt_in: false,
    sms_opt_in: false,
    tags: ["regular"],
    birthday: "1990-04-02",
    created_at: "2026-01-05T00:00:00.000Z",
    last_purchase_date: null,
    unsubscribe_token: "tok-1",
    custom_fields: { tier: "gold" },
    ...over,
  }) as CustomerRow;

const order = (over: Partial<Order> = {}): Order =>
  ({
    id: "o1",
    customer_id: "c1",
    status: "completed",
    total_cents: 1000,
    created_at: "2026-06-01T00:00:00.000Z",
    payment_method: "Card",
    order_items: [{ item_name: "Kopi O", quantity: 1 }],
    ...over,
  }) as Order;

/** The aggregate row migration 0026 would return for these orders. */
function aggregateFor(customerId: string, orders: Order[]) {
  const mine = orders.filter((o) => o.customer_id === customerId && o.status === "completed");
  const total = mine.reduce((s, o) => s + (o.total_cents ?? 0), 0);
  const qty = new Map<string, number>();
  for (const o of mine)
    for (const l of o.order_items ?? []) qty.set(l.item_name, (qty.get(l.item_name) ?? 0) + l.quantity);
  const items = [...qty.keys()].sort();
  const fav = items.slice().sort((a, b) => (qty.get(b)! - qty.get(a)!) || a.localeCompare(b))[0];
  return {
    customer_id: customerId,
    order_count: mine.length,
    total_spent_cents: total,
    avg_order_cents: mine.length ? Math.round(total / mine.length) : 0,
    newest_completed_at:
      mine.map((o) => o.created_at).sort().at(-1) ?? null,
    favourite_item: fav ?? null,
    items_purchased: items,
    payment_methods: [...new Set(mine.map((o) => o.payment_method).filter(Boolean))].sort() as string[],
  };
}

/** Compare ignoring the two fields whose ORDER is documented to differ. */
function comparable(p: ReturnType<typeof buildProfiles>[number]) {
  return {
    ...p,
    itemsPurchased: [...p.itemsPurchased].sort(),
    paymentMethods: [...p.paymentMethods].sort(),
  };
}

describe("profilesFromAggregate", () => {
  it("matches buildProfiles for a customer with orders", () => {
    const c = customer();
    const orders = [
      order({ id: "o1", total_cents: 1000, created_at: "2026-06-01T00:00:00.000Z" }),
      order({
        id: "o2",
        total_cents: 2500,
        created_at: "2026-07-15T00:00:00.000Z",
        payment_method: "Cash",
        order_items: [{ item_name: "Kaya Toast", quantity: 3 }],
      } as Partial<Order>),
    ];

    const fromOrders = buildProfiles([c], orders).map(comparable);
    const fromAgg = profilesFromAggregate([c], [aggregateFor("c1", orders)]).map(comparable);

    expect(fromAgg).toEqual(fromOrders);
    expect(fromAgg[0].orderCount).toBe(2);
    expect(fromAgg[0].totalSpentCents).toBe(3500);
    expect(fromAgg[0].avgOrderCents).toBe(1750);
    expect(fromAgg[0].favouriteItem).toBe("Kaya Toast");
  });

  it("matches buildProfiles for a customer with no orders at all", () => {
    // The left-join case: the aggregate returns a row of zeros, and a customer
    // absent from the rows entirely must come out the same way.
    const c = customer({ id: "c2" });
    const fromOrders = buildProfiles([c], []).map(comparable);

    expect(profilesFromAggregate([c], [aggregateFor("c2", [])]).map(comparable)).toEqual(fromOrders);
    expect(profilesFromAggregate([c], []).map(comparable)).toEqual(fromOrders);
  });

  it("prefers last_purchase_date over the newest order, like buildProfiles", () => {
    // The maintained column wins even when it is OLDER than the newest order —
    // the rule is "prefer the column", not "take the later of the two".
    const c = customer({ last_purchase_date: "2026-02-02T00:00:00.000Z" });
    const orders = [order({ created_at: "2026-09-09T00:00:00.000Z" })];

    const fromOrders = buildProfiles([c], orders);
    const fromAgg = profilesFromAggregate([c], [aggregateFor("c1", orders)]);

    expect(fromAgg[0].lastVisit).toBe("2026-02-02T00:00:00.000Z");
    expect(fromAgg[0].lastVisit).toBe(fromOrders[0].lastVisit);
  });

  it("reads bigint columns that arrive as strings", () => {
    // count() and sum() are bigint; some client versions hand them back as text,
    // and a string would silently poison every numeric comparison downstream.
    const c = customer();
    const [p] = profilesFromAggregate(
      [c],
      [
        {
          customer_id: "c1",
          order_count: "4",
          total_spent_cents: "9000",
          avg_order_cents: "2250",
          newest_completed_at: "2026-07-01T00:00:00.000Z",
          favourite_item: "Kopi O",
          items_purchased: ["Kopi O"],
          payment_methods: ["Card"],
        },
      ],
    );

    expect(p.orderCount).toBe(4);
    expect(p.totalSpentCents).toBe(9000);
    expect(p.avgOrderCents).toBe(2250);
    expect(typeof p.orderCount).toBe("number");
  });

  it("keeps every customer, in input order, including ones the aggregate skipped", () => {
    const rows = [customer({ id: "a" }), customer({ id: "b" }), customer({ id: "c" })];
    const out = profilesFromAggregate(rows, [aggregateFor("b", [order({ customer_id: "b" })])]);

    expect(out.map((p) => p.id)).toEqual(["a", "b", "c"]);
    expect(out[0].orderCount).toBe(0);
    expect(out[1].orderCount).toBe(1);
  });
});
