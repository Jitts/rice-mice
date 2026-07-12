import { formatCents } from "@/lib/format";
import { orderSummary, type Order } from "@/lib/orders";

// Pure read-side aggregation for /dashboard/reports. Money always means
// completed orders only — the same rule as everywhere else in the app.
// Days bucket in the device's local timezone (the shop's clock), and an
// order belongs to the day it was PLACED (created_at) — orders have no
// completion timestamp, and at counter pace the two are the same day.

export type ReportRange = { from: Date; to: Date }; // inclusive calendar days

// Guard against a runaway zero-fill on absurd custom ranges.
export const MAX_CHART_DAYS = 366;

export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function endOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}

export function dayKey(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

export type PresetId = "today" | "yesterday" | "last7" | "month" | "last30";

export const PRESETS: { id: PresetId; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "yesterday", label: "Yesterday" },
  { id: "last7", label: "Last 7 days" },
  { id: "month", label: "This month" },
  { id: "last30", label: "Last 30 days" },
];

export function presetRange(id: PresetId, now: Date = new Date()): ReportRange {
  const today = startOfDay(now);
  const daysAgo = (n: number) =>
    new Date(today.getFullYear(), today.getMonth(), today.getDate() - n);
  switch (id) {
    case "today":
      return { from: today, to: today };
    case "yesterday":
      return { from: daysAgo(1), to: daysAgo(1) };
    case "last7":
      return { from: daysAgo(6), to: today };
    case "month":
      return { from: new Date(today.getFullYear(), today.getMonth(), 1), to: today };
    case "last30":
      return { from: daysAgo(29), to: today };
  }
}

export function inRange(iso: string, range: ReportRange): boolean {
  const t = new Date(iso).getTime();
  return t >= startOfDay(range.from).getTime() && t <= endOfDay(range.to).getTime();
}

export type DayBucket = { key: string; revenueCents: number; orders: number };
export type NameBucket = { name: string; orders: number; revenueCents: number };
export type ItemBucket = { name: string; quantity: number; grossCents: number };

export type ReportSummary = {
  revenueCents: number;
  completedCount: number;
  avgOrderCents: number; // 0 when there are no completed orders
  discountCents: number;
  cancelledCount: number;
  byDay: DayBucket[]; // zero-filled, oldest first (capped at MAX_CHART_DAYS)
  byItem: ItemBucket[]; // gross line sales (pre-discount), biggest first
  byPayment: NameBucket[];
  byStaff: NameBucket[];
};

function bumpName(map: Map<string, NameBucket>, name: string, cents: number) {
  const b = map.get(name) ?? { name, orders: 0, revenueCents: 0 };
  b.orders += 1;
  b.revenueCents += cents;
  map.set(name, b);
}

export function buildReport(orders: Order[], range: ReportRange): ReportSummary {
  const inWindow = orders.filter((o) => inRange(o.created_at, range));
  const completed = inWindow.filter((o) => o.status === "completed");
  const cancelledCount = inWindow.filter((o) => o.status === "cancelled").length;

  const revenueCents = completed.reduce((s, o) => s + o.total_cents, 0);
  const discountCents = completed.reduce((s, o) => s + (o.discount_cents ?? 0), 0);
  const completedCount = completed.length;
  const avgOrderCents =
    completedCount === 0 ? 0 : Math.round(revenueCents / completedCount);

  // Zero-filled day buckets so quiet days show as gaps, not missing bars.
  const byDay: DayBucket[] = [];
  const byDayIndex = new Map<string, DayBucket>();
  const cursor = startOfDay(range.from);
  const last = startOfDay(range.to).getTime();
  while (cursor.getTime() <= last && byDay.length < MAX_CHART_DAYS) {
    const bucket = { key: dayKey(cursor), revenueCents: 0, orders: 0 };
    byDay.push(bucket);
    byDayIndex.set(bucket.key, bucket);
    cursor.setDate(cursor.getDate() + 1);
  }
  for (const o of completed) {
    const bucket = byDayIndex.get(dayKey(new Date(o.created_at)));
    if (bucket) {
      bucket.revenueCents += o.total_cents;
      bucket.orders += 1;
    }
  }

  // Item sales are gross (line price × qty, before any order-level discount):
  // an offer discounts the whole order, so it can't be attributed to lines.
  const itemMap = new Map<string, ItemBucket>();
  const paymentMap = new Map<string, NameBucket>();
  const staffMap = new Map<string, NameBucket>();
  for (const o of completed) {
    for (const l of o.order_items ?? []) {
      const b = itemMap.get(l.item_name) ?? {
        name: l.item_name,
        quantity: 0,
        grossCents: 0,
      };
      b.quantity += l.quantity;
      b.grossCents += l.unit_price_cents * l.quantity;
      itemMap.set(l.item_name, b);
    }
    bumpName(paymentMap, o.payment_method ?? "unspecified", o.total_cents);
    bumpName(staffMap, o.staff_name?.trim() || "(no name)", o.total_cents);
  }

  return {
    revenueCents,
    completedCount,
    avgOrderCents,
    discountCents,
    cancelledCount,
    byDay,
    byItem: [...itemMap.values()].sort((a, b) => b.grossCents - a.grossCents),
    byPayment: [...paymentMap.values()].sort((a, b) => b.revenueCents - a.revenueCents),
    byStaff: [...staffMap.values()].sort((a, b) => b.revenueCents - a.revenueCents),
  };
}

// --- CSV export --------------------------------------------------------------

function csvCell(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

// Every order in the range (all statuses — a bookkeeping export, not a
// revenue number), one row per order with its items summarised.
export function reportCsv(orders: Order[], range: ReportRange): string {
  const header = [
    "order_no",
    "placed_at",
    "status",
    "staff",
    "payment_method",
    "items",
    "discount",
    "total_charged",
  ];
  const rows = orders
    .filter((o) => inRange(o.created_at, range))
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map((o) =>
      [
        String(o.order_no),
        new Date(o.created_at).toLocaleString(),
        o.status,
        o.staff_name ?? "",
        o.payment_method ?? "",
        orderSummary(o),
        formatCents(o.discount_cents ?? 0),
        formatCents(o.total_cents),
      ]
        .map(csvCell)
        .join(","),
    );
  return [header.join(","), ...rows].join("\n");
}
