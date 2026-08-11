import { describe, it, expect } from "vitest";
import { parseCsv } from "@/lib/csv";
import {
  autoMapOrderColumns,
  buildItemIndex,
  groupIntoOrders,
  matchItem,
  parseMoneyCents,
  parseOrderLines,
  parseTimeOfDay,
  readStatus,
  resolveOrders,
  summarizeOrders,
  toTimestamp,
  type ExistingCustomerRef,
  type UnmatchedPolicy,
} from "@/lib/orderImport";
import { buildProfiles, stageOf, type CustomerRow } from "@/lib/segments";
import type { Order } from "@/lib/orders";

const SGT = 480;

// CSV text → everything the wizard and the server action both compute, so a
// test exercises the same pipeline in the same order they do.
function run(
  csv: string,
  existing: ExistingCustomerRef[] = [],
  existingRefs: string[] = [],
  policy: UnmatchedPolicy = "skip",
  catalog: { id: string; name: string }[] = [],
  createCustomers = false,
) {
  const table = parseCsv(csv);
  const mappings = autoMapOrderColumns(table);
  const lines = parseOrderLines(table, mappings, Date.parse("2026-08-10T00:00:00Z"));
  const { orders, errored } = groupIntoOrders(lines, SGT);
  const { resolved, newCustomers } = resolveOrders(
    orders,
    existing,
    existingRefs,
    policy,
    createCustomers,
  );
  const itemIndex = buildItemIndex(catalog);
  return {
    mappings,
    lines,
    orders,
    errored,
    resolved,
    newCustomers,
    summary: summarizeOrders(resolved, errored, lines, itemIndex, newCustomers),
  };
}

const AMARA: ExistingCustomerRef = {
  id: "c-amara",
  phone: "+6591234567",
  email: "amara@example.com",
};
const SIPHO: ExistingCustomerRef = {
  id: "c-sipho",
  phone: "+6598887777",
  email: "sipho@example.com",
};

const SQUARE = [
  "Receipt Number,Date,Time,Customer Email,Customer Phone,Item,Qty,Unit Price,Discount,Net Sales,Payment Method,Status",
  "R-1044,2026-07-14,12:31:02,amara@example.com,+65 9123 4567,Rice Bowl (Large),1,8.50,,8.50,Card,Completed",
  "R-1044,2026-07-14,12:31:02,amara@example.com,+65 9123 4567,Iced Tea,2,2.80,1.00,4.60,Card,Completed",
  "R-1045,2026-07-14,12:48:19,,,Kaya Toast,1,3.20,,3.20,Cash,Completed",
].join("\n");

describe("money parsing", () => {
  it("reads plain and symbol-prefixed amounts as cents", () => {
    expect(parseMoneyCents("8.50")).toBe(850);
    expect(parseMoneyCents("$8.50")).toBe(850);
    expect(parseMoneyCents("S$ 8.50")).toBe(850);
    expect(parseMoneyCents("8")).toBe(800);
  });

  it("reads both decimal conventions", () => {
    expect(parseMoneyCents("1,234.50")).toBe(123450);
    expect(parseMoneyCents("1.234,50")).toBe(123450);
    expect(parseMoneyCents("12,34")).toBe(1234);
    expect(parseMoneyCents("1,234")).toBe(123400);
  });

  it("reads accounting and signed negatives", () => {
    expect(parseMoneyCents("(8.50)")).toBe(-850);
    expect(parseMoneyCents("-8.50")).toBe(-850);
  });

  it("returns null for blanks rather than zero", () => {
    // Zero and "no value" are different: a zero line total is a comp, a blank
    // means fall back to quantity x unit price.
    expect(parseMoneyCents("")).toBeNull();
    expect(parseMoneyCents(null)).toBeNull();
    expect(parseMoneyCents("  ")).toBeNull();
    expect(parseMoneyCents("0.00")).toBe(0);
  });

  it("doesn't lose a cent to binary floating point", () => {
    expect(parseMoneyCents("3.145")).toBe(315);
    expect(parseMoneyCents("19.99")).toBe(1999);
    expect(parseMoneyCents("0.07")).toBe(7);
  });
});

describe("time and timestamps", () => {
  it("reads 24-hour and 12-hour clocks", () => {
    expect(parseTimeOfDay("12:31:02")).toBe("12:31:02");
    expect(parseTimeOfDay("09:05")).toBe("09:05:00");
    expect(parseTimeOfDay("2:05 pm")).toBe("14:05:00");
    expect(parseTimeOfDay("12:30 AM")).toBe("00:30:00");
    expect(parseTimeOfDay("")).toBeNull();
  });

  it("treats the file's clock as shop-local, not UTC", () => {
    // The whole point of the offset: 23:30 in Singapore is still the 14th's
    // takings, and reading it as UTC would file it under the 15th.
    expect(toTimestamp("2026-07-14", "23:30:00", SGT)).toBe("2026-07-14T15:30:00.000Z");
    expect(toTimestamp("2026-07-14", "23:30:00", 0)).toBe("2026-07-14T23:30:00.000Z");
  });

  it("puts a row with no time at local midday, safe from either day boundary", () => {
    const at = toTimestamp("2026-07-14", null, SGT);
    expect(at).toBe("2026-07-14T04:00:00.000Z");
  });

  it("pulls the time out of a combined date cell", () => {
    const csv = [
      "Order ID,Date,Customer Email,Item,Unit Price",
      "A1,2026-07-14 18:45:00,amara@example.com,Kopi O,1.80",
    ].join("\n");
    const { orders } = run(csv);
    expect(orders[0].at).toBe("2026-07-14T10:45:00.000Z");
  });
});

describe("status", () => {
  it("counts sales and excludes reversals", () => {
    expect(readStatus("Completed")).toEqual({ status: "completed", recognised: true });
    expect(readStatus("PAID")).toEqual({ status: "completed", recognised: true });
    expect(readStatus("Refunded")).toEqual({ status: "cancelled", recognised: true });
    expect(readStatus("Voided")).toEqual({ status: "cancelled", recognised: true });
  });

  it("treats a missing status as a completed sale", () => {
    expect(readStatus("")).toEqual({ status: "completed", recognised: true });
    expect(readStatus(null)).toEqual({ status: "completed", recognised: true });
  });

  it("flags a word it doesn't know instead of quietly counting it", () => {
    const reading = readStatus("Pending");
    expect(reading.status).toBe("completed");
    expect(reading.recognised).toBe(false);
  });

  it("surfaces the unknown values in the summary so the preview can name them", () => {
    const csv = [
      "Order ID,Date,Customer Email,Item,Unit Price,Status",
      "A1,2026-07-14,amara@example.com,Kopi O,1.80,Pending",
    ].join("\n");
    expect(run(csv, [AMARA]).summary.unknownStatuses).toEqual(["Pending"]);
  });

  it("cancels the whole receipt when any line of it is voided", () => {
    const csv = [
      "Receipt Number,Date,Time,Customer Email,Item,Unit Price,Status",
      "R-1,2026-07-14,10:00:00,amara@example.com,Kopi O,1.80,Completed",
      "R-1,2026-07-14,10:00:00,amara@example.com,Croissant,4.20,Refunded",
    ].join("\n");
    const { orders } = run(csv, [AMARA]);
    expect(orders).toHaveLength(1);
    expect(orders[0].status).toBe("cancelled");
  });
});

describe("column mapping", () => {
  it("recognises a Square items export", () => {
    const { mappings } = run(SQUARE);
    const byHeader = Object.fromEntries(
      mappings.map((m) => [m.header, m.target.kind === "builtin" ? m.target.id : "ignore"]),
    );
    expect(byHeader["Receipt Number"]).toBe("order_ref");
    expect(byHeader["Date"]).toBe("ordered_at");
    expect(byHeader["Time"]).toBe("ordered_time");
    expect(byHeader["Customer Email"]).toBe("customer_email");
    expect(byHeader["Customer Phone"]).toBe("customer_phone");
    expect(byHeader["Item"]).toBe("item_name");
    expect(byHeader["Qty"]).toBe("quantity");
    expect(byHeader["Unit Price"]).toBe("unit_price");
    expect(byHeader["Net Sales"]).toBe("line_total");
    expect(byHeader["Status"]).toBe("status");
  });

  it("gives 'Order Total' to the total, not to the receipt number", () => {
    // "order" is an alias of order_ref; without longest-alias-first ordering
    // this column would be claimed as the receipt id.
    const csv = "Order Total,Date\n12.00,2026-07-14";
    const { mappings } = run(csv);
    expect(mappings[0].target).toEqual({ kind: "builtin", id: "order_total" });
  });

  it("ignores columns it doesn't know rather than inventing fields for them", () => {
    const csv = "Date,Item,Unit Price,Table Number,Loyalty Card\n2026-07-14,Kopi O,1.80,7,X99";
    const { mappings } = run(csv);
    expect(mappings.filter((m) => m.target.kind === "ignore").map((m) => m.header)).toEqual([
      "Table Number",
      "Loyalty Card",
    ]);
  });
});

describe("grouping lines into orders", () => {
  it("collapses rows sharing a receipt number into one multi-line order", () => {
    const { orders } = run(SQUARE, [AMARA]);
    expect(orders).toHaveLength(2);
    const r1044 = orders[0];
    expect(r1044.importRef).toBe("R-1044");
    expect(r1044.lines).toHaveLength(2);
    expect(r1044.rowNumbers).toEqual([2, 3]);
    // 8.50 + 4.60 net, with the 1.00 discount already taken off the second line.
    expect(r1044.totalCents).toBe(1310);
    expect(r1044.discountCents).toBe(100);
  });

  it("falls back to quantity x price - discount when there's no line total", () => {
    const csv = [
      "Receipt Number,Date,Time,Customer Email,Item,Qty,Unit Price,Discount",
      "R-9,2026-07-14,10:00:00,amara@example.com,Iced Tea,2,2.80,1.00",
    ].join("\n");
    const { orders } = run(csv, [AMARA]);
    expect(orders[0].totalCents).toBe(460);
  });

  it("reads an order-total column once per receipt instead of summing it per line", () => {
    // Most exports repeat the order total on every line; summing would triple
    // a three-line receipt.
    const csv = [
      "Receipt Number,Date,Time,Customer Email,Item,Unit Price,Total",
      "R-7,2026-07-14,10:00:00,amara@example.com,Kopi O,1.80,6.00",
      "R-7,2026-07-14,10:00:00,amara@example.com,Croissant,4.20,6.00",
    ].join("\n");
    const { orders } = run(csv, [AMARA]);
    expect(orders).toHaveLength(1);
    expect(orders[0].totalCents).toBe(600);
  });

  it("groups by customer and time when the file has no receipt number", () => {
    const csv = [
      "Date,Time,Customer Email,Item,Unit Price",
      "2026-07-14,10:00:00,amara@example.com,Kopi O,1.80",
      "2026-07-14,10:00:00,amara@example.com,Croissant,4.20",
      "2026-07-14,15:20:00,amara@example.com,Kaya Toast,3.20",
    ].join("\n");
    const { orders } = run(csv, [AMARA]);
    expect(orders).toHaveLength(2);
    expect(orders[0].lines).toHaveLength(2);
    expect(orders.every((o) => o.generatedRef)).toBe(true);
    expect(orders[0].importRef).toMatch(/^auto:[0-9a-f]{16}$/);
  });

  it("never merges anonymous same-day rows into one giant receipt", () => {
    // No receipt number, no customer, no time — the only safe reading is that
    // these are separate walk-ins, not one 3-item order.
    const csv = [
      "Date,Item,Unit Price",
      "2026-07-14,Kopi O,1.80",
      "2026-07-14,Croissant,4.20",
      "2026-07-14,Kaya Toast,3.20",
    ].join("\n");
    expect(run(csv).orders).toHaveLength(3);
  });
});

describe("row problems", () => {
  it("rejects a row with no date rather than guessing one", () => {
    const csv = [
      "Receipt Number,Date,Customer Email,Item,Unit Price",
      "R-1,,amara@example.com,Kopi O,1.80",
    ].join("\n");
    const { errored, orders } = run(csv, [AMARA]);
    expect(orders).toHaveLength(0);
    expect(errored[0].errors[0]).toMatch(/No date/);
  });

  it("rejects negative amounts, which would fail the schema's own check", () => {
    const csv = [
      "Receipt Number,Date,Customer Email,Item,Unit Price,Net Sales",
      "R-1,2026-07-14,amara@example.com,Refund,-1.80,-1.80",
    ].join("\n");
    expect(run(csv, [AMARA]).errored[0].errors.join(" ")).toMatch(/negative/);
  });

  it("rejects a quantity that isn't a whole number above zero", () => {
    const csv = [
      "Receipt Number,Date,Customer Email,Item,Qty,Unit Price",
      "R-1,2026-07-14,amara@example.com,Kopi O,0,1.80",
    ].join("\n");
    expect(run(csv, [AMARA]).errored[0].errors.join(" ")).toMatch(/whole number/);
  });

  it("rejects a future date", () => {
    const csv = [
      "Receipt Number,Date,Customer Email,Item,Unit Price",
      "R-1,2027-01-01,amara@example.com,Kopi O,1.80",
    ].join("\n");
    expect(run(csv, [AMARA]).errored[0].errors.join(" ")).toMatch(/future/);
  });

  it("keeps an order whose email is malformed, but can't attach it", () => {
    // The sale happened. It just can't be attributed, which is an unmatched
    // receipt to report — not a parse failure to throw away.
    const csv = [
      "Receipt Number,Date,Customer Email,Item,Unit Price",
      "R-1,2026-07-14,not-an-email,Kopi O,1.80",
    ].join("\n");
    const { errored, summary } = run(csv, [AMARA]);
    expect(errored).toHaveLength(0);
    expect(summary.skipWalkIn).toBe(1);
  });
});

describe("customer resolution", () => {
  it("matches on phone and on email, however the number is formatted", () => {
    const { resolved } = run(SQUARE, [AMARA]);
    expect(resolved[0].outcome).toEqual({
      kind: "create",
      customerId: "c-amara",
      newCustomerKey: null,
    });
  });

  it("refuses to pick a side when email and phone name different customers", () => {
    // Shared handsets and counter typos produce these. Guessing would move the
    // wrong customer's last visit, which can flip their lifecycle stage.
    const csv = [
      "Receipt Number,Date,Customer Email,Customer Phone,Item,Unit Price",
      "R-1,2026-07-14,amara@example.com,+65 9888 7777,Kopi O,1.80",
    ].join("\n");
    const { resolved, summary } = run(csv, [AMARA, SIPHO]);
    expect(resolved[0].outcome).toEqual({
      kind: "conflict",
      emailCustomerId: "c-amara",
      phoneCustomerId: "c-sipho",
    });
    expect(summary.conflicts).toBe(1);
    expect(summary.create).toBe(0);
  });

  it("leaves unmatched receipts out by default, and reports them separately", () => {
    const { summary } = run(SQUARE, [AMARA]);
    expect(summary.create).toBe(1);
    expect(summary.skipWalkIn).toBe(1); // R-1045 has no customer on it at all
    expect(summary.skipNoCustomerMatch).toBe(0);
  });

  it("distinguishes a walk-in from a reference that matches nobody", () => {
    const csv = [
      "Receipt Number,Date,Customer Email,Item,Unit Price",
      "R-1,2026-07-14,,Kopi O,1.80",
      "R-2,2026-07-14,ghost@example.com,Kopi O,1.80",
    ].join("\n");
    const { summary } = run(csv, [AMARA]);
    expect(summary.skipWalkIn).toBe(1);
    expect(summary.skipNoCustomerMatch).toBe(1);
  });

  it("brings unmatched receipts in as walk-in sales when asked to", () => {
    const { summary } = run(SQUARE, [AMARA], [], "unattached");
    expect(summary.create).toBe(2);
    expect(summary.attachedToCustomers).toBe(1);
    expect(summary.unattached).toBe(1);
  });

  it("still refuses conflicts even when unmatched rows are being imported", () => {
    const csv = [
      "Receipt Number,Date,Customer Email,Customer Phone,Item,Unit Price",
      "R-1,2026-07-14,amara@example.com,+65 9888 7777,Kopi O,1.80",
    ].join("\n");
    const { summary } = run(csv, [AMARA, SIPHO], [], "unattached");
    expect(summary.conflicts).toBe(1);
    expect(summary.create).toBe(0);
  });
});

describe("idempotency", () => {
  it("re-importing the same file creates zero new orders", () => {
    const first = run(SQUARE, [AMARA], [], "unattached");
    const refs = first.resolved
      .filter((r) => r.outcome.kind === "create")
      .map((r) => r.order.importRef);
    expect(refs).toHaveLength(2);

    const second = run(SQUARE, [AMARA], refs, "unattached");
    expect(second.summary.create).toBe(0);
    expect(second.summary.skipAlreadyImported).toBe(2);
  });

  it("is stable for generated keys too, so a file with no receipt numbers is safe to re-run", () => {
    const csv = [
      "Date,Time,Customer Email,Item,Unit Price",
      "2026-07-14,10:00:00,amara@example.com,Kopi O,1.80",
      "2026-07-15,11:00:00,amara@example.com,Croissant,4.20",
    ].join("\n");
    const first = run(csv, [AMARA]);
    const refs = first.orders.map((o) => o.importRef);
    expect(new Set(refs).size).toBe(2); // and not colliding with each other

    const second = run(csv, [AMARA], refs);
    expect(second.summary.create).toBe(0);
    expect(second.summary.skipAlreadyImported).toBe(2);
  });

  it("treats repeated receipt numbers as one order, wherever they sit in the file", () => {
    // Exports that concatenate two date ranges repeat whole receipts. Grouping
    // is by key, not by adjacency, so the receipt is assembled once.
    const csv = [
      "Receipt Number,Date,Customer Email,Item,Unit Price",
      "R-1,2026-07-14,amara@example.com,Kopi O,1.80",
      "R-2,2026-07-15,amara@example.com,Croissant,4.20",
      "R-1,2026-07-14,amara@example.com,Kopi O,1.80",
    ].join("\n");
    const { orders, summary } = run(csv, [AMARA]);
    expect(orders).toHaveLength(2);
    expect(orders[0].lines).toHaveLength(2);
    expect(summary.create).toBe(2);
  });

  it("collapses byte-identical anonymous rows, and says so", () => {
    // No receipt number, no customer, no clock: nothing distinguishes these two
    // rows, so they hash to the same key and the second is reported as a
    // duplicate rather than silently written twice. A duplicated export line is
    // the more common cause than two genuinely identical same-day walk-ins, and
    // the preview names the count either way.
    const csv = [
      "Date,Item,Unit Price",
      "2026-07-14,Kopi O,1.80",
      "2026-07-14,Kopi O,1.80",
    ].join("\n");
    const { summary } = run(csv, [], [], "unattached");
    expect(summary.create).toBe(1);
    expect(summary.skipDuplicateInFile).toBe(1);
  });
});

describe("item matching", () => {
  const catalog = [
    { id: "i-large", name: "Rice Bowl (Large)" },
    { id: "i-tea", name: "Iced Tea" },
  ];

  it("matches the catalog ignoring case and spacing", () => {
    const index = buildItemIndex(catalog);
    expect(matchItem("rice bowl (large)", index)).toBe("i-large");
    expect(matchItem("  Iced   Tea ", index)).toBe("i-tea");
  });

  it("keeps an unknown item as free text rather than adding it to the menu", () => {
    const { summary } = run(SQUARE, [AMARA], [], "unattached", catalog);
    expect(summary.unmatchedItems).toEqual(["Kaya Toast"]);
  });
});

describe("summary totals", () => {
  it("counts only completed orders as revenue", () => {
    const csv = [
      "Receipt Number,Date,Customer Email,Item,Unit Price,Status",
      "R-1,2026-07-14,amara@example.com,Kopi O,10.00,Completed",
      "R-2,2026-07-14,amara@example.com,Kopi O,10.00,Refunded",
    ].join("\n");
    const { summary } = run(csv, [AMARA]);
    expect(summary.create).toBe(2);
    expect(summary.cancelled).toBe(1);
    expect(summary.revenueCents).toBe(1000);
  });

  it("counts each affected customer once, not once per receipt", () => {
    const csv = [
      "Receipt Number,Date,Customer Email,Item,Unit Price",
      "R-1,2026-07-14,amara@example.com,Kopi O,1.80",
      "R-2,2026-07-15,amara@example.com,Kopi O,1.80",
      "R-3,2026-07-16,sipho@example.com,Kopi O,1.80",
    ].join("\n");
    const { summary } = run(csv, [AMARA, SIPHO]);
    expect(summary.attachedToCustomers).toBe(3);
    expect(summary.customersTouched).toBe(2);
  });
});

// --- What the import is actually for -------------------------------------------
// The sprint's whole payoff: after importing history, the derived profile
// fields are right and lifecycle stages stop saying "New". These build the
// order rows the way the server action writes them and run the real engine.

function ordersFrom(
  drafts: ReturnType<typeof run>["resolved"],
): Order[] {
  return drafts.flatMap(({ order, outcome }, i) =>
    outcome.kind === "create"
      ? [
          {
            id: `o-${i}`,
            order_no: i + 1,
            customer_id: outcome.customerId,
            status: order.status,
            payment_method: order.paymentMethod,
            staff_name: order.staff,
            total_cents: order.totalCents,
            discount_cents: order.discountCents,
            campaign_id: null,
            reward_id: null,
            reward_points_spent: 0,
            created_at: order.at,
            order_items: order.lines.map((l, n) => ({
              id: `l-${i}-${n}`,
              order_id: `o-${i}`,
              item_id: null,
              item_name: l.itemName,
              unit_price_cents: l.unitPriceCents,
              quantity: l.quantity,
            })),
          } satisfies Order,
        ]
      : [],
  );
}

function customerRow(id: string, overrides: Partial<CustomerRow> = {}): CustomerRow {
  return {
    id,
    first_name: "Test",
    last_name: "Customer",
    phone: null,
    email: null,
    whatsapp_opt_in: false,
    email_opt_in: false,
    sms_opt_in: false,
    tags: [],
    birthday: null,
    created_at: "2024-01-01T00:00:00.000Z",
    last_purchase_date: null,
    unsubscribe_token: null,
    custom_fields: {},
    ...overrides,
  };
}

/** Days before now, as the ISO date a POS export would write. */
function daysAgo(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
}

describe("what the imported history produces", () => {
  it("derives spend, order count, average, favourite item and last visit", () => {
    const csv = [
      "Receipt Number,Date,Time,Customer Email,Item,Qty,Unit Price,Net Sales",
      `R-1,${daysAgo(20)},10:00:00,amara@example.com,Rice Bowl (Large),1,8.50,8.50`,
      `R-2,${daysAgo(10)},10:00:00,amara@example.com,Iced Tea,2,2.80,5.60`,
      `R-2,${daysAgo(10)},10:00:00,amara@example.com,Rice Bowl (Large),1,8.50,8.50`,
      `R-3,${daysAgo(2)},10:00:00,amara@example.com,Iced Tea,1,2.80,2.80`,
    ].join("\n");
    const { resolved, orders } = run(csv, [AMARA]);
    const profile = buildProfiles(
      [customerRow("c-amara", { email: "amara@example.com" })],
      ordersFrom(resolved),
    )[0];

    expect(profile.orderCount).toBe(3);
    expect(profile.totalSpentCents).toBe(850 + 1410 + 280);
    expect(profile.avgOrderCents).toBe(Math.round((850 + 1410 + 280) / 3));
    // Iced Tea: 2 + 1 = 3 units, beating Rice Bowl's 2.
    expect(profile.favouriteItem).toBe("Iced Tea");
    expect(new Set(profile.itemsPurchased)).toEqual(
      new Set(["Rice Bowl (Large)", "Iced Tea"]),
    );
    expect(profile.lastVisit).toBe(orders[2].at);
  });

  it("classifies a lapsed imported customer as at risk, not New", () => {
    const csv = [
      "Receipt Number,Date,Time,Customer Email,Item,Unit Price,Net Sales",
      `R-1,${daysAgo(45)},10:00:00,amara@example.com,Kopi O,1.80,1.80`,
    ].join("\n");
    const { resolved } = run(csv, [AMARA]);
    const profile = buildProfiles(
      [customerRow("c-amara", { email: "amara@example.com" })],
      ordersFrom(resolved),
    )[0];
    expect(stageOf(profile)).toBe("at_risk");
  });

  it("classifies a long-gone imported customer as churned", () => {
    const csv = [
      "Receipt Number,Date,Time,Customer Email,Item,Unit Price,Net Sales",
      `R-1,${daysAgo(200)},10:00:00,amara@example.com,Kopi O,1.80,1.80`,
    ].join("\n");
    const { resolved } = run(csv, [AMARA]);
    const profile = buildProfiles(
      [customerRow("c-amara", { email: "amara@example.com" })],
      ordersFrom(resolved),
    )[0];
    expect(stageOf(profile)).toBe("churned");
  });

  it("makes a frequent recent buyer loyal", () => {
    const csv = [
      "Receipt Number,Date,Time,Customer Email,Item,Unit Price,Net Sales",
      `R-1,${daysAgo(20)},10:00:00,amara@example.com,Kopi O,1.80,1.80`,
      `R-2,${daysAgo(12)},10:00:00,amara@example.com,Kopi O,1.80,1.80`,
      `R-3,${daysAgo(3)},10:00:00,amara@example.com,Kopi O,1.80,1.80`,
    ].join("\n");
    const { resolved } = run(csv, [AMARA]);
    const profile = buildProfiles(
      [customerRow("c-amara", { email: "amara@example.com" })],
      ordersFrom(resolved),
    )[0];
    expect(profile.orderCount).toBe(3);
    expect(stageOf(profile)).toBe("loyal");
  });

  it("leaves a customer with only cancelled receipts as New", () => {
    // A refunded-only history is not a purchase history, and counting it would
    // promote someone who has never actually bought anything.
    const csv = [
      "Receipt Number,Date,Time,Customer Email,Item,Unit Price,Net Sales,Status",
      `R-1,${daysAgo(5)},10:00:00,amara@example.com,Kopi O,1.80,1.80,Refunded`,
    ].join("\n");
    const { resolved } = run(csv, [AMARA]);
    const profile = buildProfiles(
      [customerRow("c-amara", { email: "amara@example.com" })],
      ordersFrom(resolved),
    )[0];
    expect(profile.orderCount).toBe(0);
    expect(stageOf(profile)).toBe("new");
  });
});

// Sprint 48: creating the customers a POS-only export names. Before this, a
// shop whose only export was a receipt file had no way in at all — the importer
// could attach orders to people already on file and nothing else.
describe("creating customers from receipts", () => {
  const NAMED = [
    "Receipt Number,Date,Time,Customer Name,Customer Email,Customer Phone,Item,Unit Price",
    "R-1,2026-05-02,09:15:00,Amara Okafor,amara@example.com,+65 9123 4567,Kopi O,1.80",
    "R-2,2026-06-11,10:20:00,Amara Okafor,amara@example.com,+65 9123 4567,Kaya Toast,3.20",
    "R-3,2026-07-03,11:05:00,Sipho Dlamini,sipho@example.com,+65 9888 7777,Kopi C,2.00",
  ].join("\n");

  it("creates nobody unless asked", () => {
    const { newCustomers, summary } = run(NAMED, [], [], "skip", [], false);
    expect(newCustomers).toHaveLength(0);
    expect(summary.skipNoCustomerMatch).toBe(3);
  });

  it("creates one customer per person, not per receipt", () => {
    const { newCustomers, summary } = run(NAMED, [], [], "skip", [], true);
    expect(newCustomers).toHaveLength(2);
    expect(summary.newCustomers).toBe(2);
    expect(summary.attachedToNewCustomers).toBe(3);
    expect(summary.create).toBe(3);
  });

  it("dates them from their earliest receipt, not from today", () => {
    // Import day would put a fake spike on the growth chart and make the
    // signed_up criterion useless — the failure Klaviyo exports already have.
    const { newCustomers } = run(NAMED, [], [], "skip", [], true);
    const amara = newCustomers.find((c) => c.email === "amara@example.com")!;
    expect(amara.createdAt.slice(0, 10)).toBe("2026-05-02");
    expect(amara.orderCount).toBe(2);
  });

  it("splits a full name into first and last", () => {
    const { newCustomers } = run(NAMED, [], [], "skip", [], true);
    const amara = newCustomers.find((c) => c.email === "amara@example.com")!;
    expect(amara.firstName).toBe("Amara");
    expect(amara.lastName).toBe("Okafor");
  });

  it("treats a phone-only and an email-only receipt as one person when they ever appear together", () => {
    // The link is transitive: one receipt carrying both handles joins every
    // other receipt carrying either. Without this the importer would create the
    // exact duplicate the merge tool then has to clean up.
    const csv = [
      "Receipt Number,Date,Time,Customer Name,Customer Email,Customer Phone,Item,Unit Price",
      "R-1,2026-05-02,09:15:00,Amara Okafor,amara@example.com,,Kopi O,1.80",
      "R-2,2026-06-11,10:20:00,Amara Okafor,amara@example.com,+65 9123 4567,Kaya Toast,3.20",
      "R-3,2026-07-03,11:05:00,Amara Okafor,,+65 9123 4567,Kopi C,2.00",
    ].join("\n");
    const { newCustomers } = run(csv, [], [], "skip", [], true);
    expect(newCustomers).toHaveLength(1);
    expect(newCustomers[0].orderCount).toBe(3);
    expect(newCustomers[0].email).toBe("amara@example.com");
    // Stored in normalizePhone's form — digits only, no leading plus — which is
    // the same shape the Sprint 45 customer import writes, so the two importers
    // can't produce records that fail to match each other.
    expect(newCustomers[0].phone).toBe("6591234567");
  });

  it("refuses to create when one phone carries two emails", () => {
    // A shared handset or a recycled number. Creating a record here would
    // invent a duplicate, so it refuses for the same reason the conflict branch
    // refuses to attach.
    const csv = [
      "Receipt Number,Date,Time,Customer Name,Customer Email,Customer Phone,Item,Unit Price",
      "R-1,2026-05-02,09:15:00,Amara Okafor,amara@example.com,+65 9123 4567,Kopi O,1.80",
      "R-2,2026-06-11,10:20:00,Sipho Dlamini,sipho@example.com,+65 9123 4567,Kaya Toast,3.20",
    ].join("\n");
    const { newCustomers, summary } = run(csv, [], [], "skip", [], true);
    expect(newCustomers).toHaveLength(0);
    expect(summary.skipAmbiguousIdentity).toBe(2);
  });

  it("refuses to create someone with no name", () => {
    const csv = [
      "Receipt Number,Date,Time,Customer Email,Item,Unit Price",
      "R-1,2026-05-02,09:15:00,ghost@example.com,Kopi O,1.80",
    ].join("\n");
    const { newCustomers, summary } = run(csv, [], [], "skip", [], true);
    expect(newCustomers).toHaveLength(0);
    expect(summary.skipNoNameToCreate).toBe(1);
  });

  it("still lands an unnameable receipt as a walk-in sale when that's the policy", () => {
    // Not creatable is not the same as not importable: a shop asking for every
    // sale still gets the revenue, it just doesn't get a customer.
    const csv = [
      "Receipt Number,Date,Time,Customer Email,Item,Unit Price",
      "R-1,2026-05-02,09:15:00,ghost@example.com,Kopi O,1.80",
    ].join("\n");
    const { summary } = run(csv, [], [], "unattached", [], true);
    expect(summary.create).toBe(1);
    expect(summary.unattached).toBe(1);
    expect(summary.skipNoNameToCreate).toBe(0);
  });

  it("attaches to someone already on file rather than creating them again", () => {
    const { newCustomers, summary } = run(NAMED, [AMARA], [], "skip", [], true);
    expect(newCustomers).toHaveLength(1);
    expect(newCustomers[0].email).toBe("sipho@example.com");
    expect(summary.attachedToCustomers).toBe(2);
  });

  it("does not create from a receipt whose email and phone name two people on file", () => {
    // The conflict branch wins: these are two EXISTING customers, and the fix
    // is the merge tool, not a third record.
    const csv = [
      "Receipt Number,Date,Time,Customer Name,Customer Email,Customer Phone,Item,Unit Price",
      "R-1,2026-05-02,09:15:00,Amara Okafor,amara@example.com,+65 9888 7777,Kopi O,1.80",
    ].join("\n");
    const { newCustomers, summary } = run(csv, [AMARA, SIPHO], [], "skip", [], true);
    expect(newCustomers).toHaveLength(0);
    expect(summary.conflicts).toBe(1);
  });
});
