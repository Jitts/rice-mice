// Sprint 46: the pure core of order-history CSV import — header detection,
// money and timestamp parsing, receipt grouping, customer resolution, item
// matching against the catalog, and the idempotency key.
//
// No I/O and no Supabase here, for the same reason as lib/customerImport.ts:
// the wizard previews in the browser and the server action re-runs this exact
// pipeline before writing. The browser's numbers are for the human; the
// server's re-run is the authority.
//
// The shape that drives every decision below: a real POS export has ONE ROW
// PER LINE ITEM, with the receipt number repeated across the lines of one
// order. 600 rows is ~250 orders, not 600 — so parsing rows and building
// orders are two separate steps.

import { columnValues, type CsvTable } from "@/lib/csv";
import { normalizePhone } from "@/lib/providers";
import {
  inferDateOrder,
  parseDateValue,
  normalizeHeader,
  splitFullName,
  type DateOrder,
} from "@/lib/customerImport";

// --- Money --------------------------------------------------------------------
// Cents, always. Floats are how a café's revenue ends up off by a cent per
// order and nobody can reconcile the month.

const CURRENCY_JUNK = /[^\d.,()\-]/g;

/**
 * Parses a money cell to integer cents. Handles currency symbols, thousands
 * separators, both decimal conventions, and accounting-style negatives.
 *
 * Decimal separator: when a value contains both `,` and `.` the LAST one wins
 * (so `1,234.50` and `1.234,50` both read as 1234.50). With only a comma, it
 * is a decimal point when exactly two digits follow it (`12,34` → 12.34) and a
 * thousands separator otherwise (`1,234` → 1234).
 */
export function parseMoneyCents(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  let v = raw.trim();
  if (v === "") return null;

  let negative = false;
  if (/^\(.*\)$/.test(v)) {
    negative = true;
    v = v.slice(1, -1);
  }
  v = v.replace(CURRENCY_JUNK, "");
  if (v.startsWith("-")) {
    negative = true;
    v = v.slice(1);
  }
  v = v.replace(/[()\-]/g, "");
  if (v === "") return null;

  const lastComma = v.lastIndexOf(",");
  const lastDot = v.lastIndexOf(".");
  let normalised: string;
  if (lastComma >= 0 && lastDot >= 0) {
    const decimalAt = Math.max(lastComma, lastDot);
    normalised =
      v.slice(0, decimalAt).replace(/[.,]/g, "") + "." + v.slice(decimalAt + 1);
  } else if (lastComma >= 0) {
    const after = v.length - lastComma - 1;
    normalised =
      after === 2
        ? v.slice(0, lastComma) + "." + v.slice(lastComma + 1)
        : v.replace(/,/g, "");
  } else {
    normalised = v;
  }

  const n = Number(normalised);
  if (!Number.isFinite(n)) return null;
  // Round rather than truncate: 3.145 * 100 is 314.49999999999994 in binary
  // floating point, and truncating loses a cent on perfectly ordinary prices.
  const cents = Math.round(n * 100);
  return negative ? -cents : cents;
}

// --- Timestamps ---------------------------------------------------------------
// A POS export writes the shop's wall clock with no timezone on it. Reading
// "23:30" as UTC would file that receipt under the next day for a shop in
// Singapore, which quietly moves revenue between days in every report. So the
// offset is explicit, defaulted from the importer's own browser (they're
// standing in the shop) and changeable in the wizard.

const TIME_RE = /(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([ap]\.?m\.?)?/i;

/** Pulls "14:05[:09]" or "2:05 pm" out of a cell. Null when there's no clock in it. */
export function parseTimeOfDay(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const m = TIME_RE.exec(raw.trim());
  if (!m) return null;
  let hour = Number(m[1]);
  const min = Number(m[2]);
  const sec = m[3] ? Number(m[3]) : 0;
  const meridiem = m[4]?.toLowerCase().replace(/\./g, "");
  if (meridiem === "pm" && hour < 12) hour += 12;
  if (meridiem === "am" && hour === 12) hour = 0;
  if (hour > 23 || min > 59 || sec > 59) return null;
  return `${String(hour).padStart(2, "0")}:${String(min).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

/**
 * Combines a local date and clock time into a UTC instant.
 *
 * `offsetMinutes` is the shop's offset from UTC (+480 for Singapore), so UTC =
 * local − offset. A row with no time is placed at local midday: far enough
 * from both midnight boundaries that no timezone can push it onto the wrong
 * day, which is the only thing day-granularity reports care about.
 */
export function toTimestamp(
  date: string,
  time: string | null,
  offsetMinutes: number,
): string {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm, ss] = (time ?? "12:00:00").split(":").map(Number);
  const ms = Date.UTC(y, m - 1, d, hh, mm, ss) - offsetMinutes * 60_000;
  return new Date(ms).toISOString();
}

// --- Status -------------------------------------------------------------------
// Only two land: `completed` feeds buildProfiles, `cancelled` does not. A
// refunded or voided receipt is real history but it is not a purchase, and
// counting it would inflate spend and pull someone's lifecycle stage forward.

export type ImportedStatus = "completed" | "cancelled";

const CANCELLED_WORDS = new Set([
  "cancelled", "canceled", "void", "voided", "refund", "refunded", "returned",
  "return", "failed", "declined", "chargeback", "partially refunded",
]);
const COMPLETED_WORDS = new Set([
  "completed", "complete", "paid", "closed", "fulfilled", "settled", "success",
  "successful", "captured", "done",
]);

export type StatusReading = { status: ImportedStatus; recognised: boolean };

/**
 * Unrecognised statuses fall through to `completed` — the default for a file
 * with no status column at all — but they are flagged so the preview can name
 * the exact values it didn't understand. Silently treating an unknown word as
 * a sale is how a column of "Pending" becomes revenue.
 */
export function readStatus(raw: string | null | undefined): StatusReading {
  const v = (raw ?? "").trim().toLowerCase();
  if (v === "") return { status: "completed", recognised: true };
  if (CANCELLED_WORDS.has(v)) return { status: "cancelled", recognised: true };
  if (COMPLETED_WORDS.has(v)) return { status: "completed", recognised: true };
  return { status: "completed", recognised: false };
}

// --- Column mapping -----------------------------------------------------------

export type OrderTargetId =
  | "order_ref"
  | "ordered_at"
  | "ordered_time"
  | "customer_email"
  | "customer_phone"
  | "customer_name"
  | "customer_first_name"
  | "customer_last_name"
  | "item_name"
  | "quantity"
  | "unit_price"
  | "line_total"
  | "discount"
  | "order_total"
  | "payment_method"
  | "status"
  | "staff";

export const ORDER_LABELS: Record<OrderTargetId, string> = {
  order_ref: "Receipt / order number",
  ordered_at: "Date",
  ordered_time: "Time",
  customer_email: "Customer email",
  customer_phone: "Customer phone",
  customer_name: "Customer name (split)",
  customer_first_name: "Customer first name",
  customer_last_name: "Customer last name",
  item_name: "Item",
  quantity: "Quantity",
  unit_price: "Unit price",
  line_total: "Line total",
  discount: "Discount",
  order_total: "Order total",
  payment_method: "Payment method",
  status: "Status",
  staff: "Staff",
};

// Header spellings from real POS and e-commerce exports (Square, Loyverse,
// Shopify, Toast, Lightspeed).
const ORDER_ALIASES: Record<OrderTargetId, string[]> = {
  order_ref: [
    "receiptnumber", "receiptno", "receipt", "receiptid", "ordernumber",
    "orderno", "orderid", "order", "transactionid", "transactionnumber",
    "ticketnumber", "ticket", "invoicenumber", "invoiceno", "invoice",
    "saleid", "billno", "reference",
  ],
  ordered_at: [
    "date", "orderdate", "transactiondate", "saledate", "datetime",
    "createdat", "created", "timestamp", "purchasedate", "paidat", "closedat",
  ],
  ordered_time: ["time", "ordertime", "transactiontime", "timeofday"],
  customer_email: [
    "customeremail", "email", "emailaddress", "buyeremail", "clientemail",
    "contactemail",
  ],
  customer_phone: [
    "customerphone", "phone", "phonenumber", "mobile", "mobilenumber",
    "buyerphone", "clientphone", "contactnumber", "customercontact",
  ],
  // Sprint 48: needed to CREATE a customer from a receipt — first_name and
  // last_name are both NOT NULL, so a file without any of these three columns
  // can attach orders to people already on file but can never add anyone.
  customer_name: [
    "customername", "customer", "name", "fullname", "buyername", "clientname",
    "contactname", "billingname", "customerfullname",
  ],
  customer_first_name: [
    "customerfirstname", "firstname", "first", "givenname", "buyerfirstname",
  ],
  customer_last_name: [
    "customerlastname", "lastname", "last", "surname", "buyerlastname",
  ],
  item_name: [
    "item", "itemname", "product", "productname", "productitem", "description",
    "itemdescription", "lineitem", "menuitem", "sku", "variation",
  ],
  quantity: ["qty", "quantity", "units", "itemqty", "count"],
  unit_price: [
    "unitprice", "price", "itemprice", "priceeach", "unitcost", "rate",
    "grossprice",
  ],
  line_total: [
    "linetotal", "netsales", "net", "lineamount", "itemtotal", "subtotal",
    "extendedprice", "linesubtotal",
  ],
  discount: ["discount", "discounts", "discountamount", "promotion", "savings"],
  order_total: [
    "ordertotal", "total", "totalamount", "amount", "totalpaid", "grandtotal",
    "totalcollected", "amountpaid", "receipttotal",
  ],
  payment_method: [
    "paymentmethod", "payment", "paymenttype", "tender", "tendertype",
    "cardbrand", "paidwith",
  ],
  status: ["status", "orderstatus", "state", "transactionstatus", "paymentstatus"],
  staff: [
    "staff", "staffname", "employee", "employeename", "cashier", "server",
    "soldby", "teammember",
  ],
};

// Longest alias first, so a specific header beats a generic one: without this
// "Order Total" could be claimed by order_ref's bare "order", and "Net Sales"
// by a shorter match.
const ORDER_ALIAS_ORDER = (Object.keys(ORDER_ALIASES) as OrderTargetId[]).sort(
  (a, b) =>
    Math.max(...ORDER_ALIASES[b].map((s) => s.length)) -
    Math.max(...ORDER_ALIASES[a].map((s) => s.length)),
);

export type OrderColumnTarget =
  | { kind: "builtin"; id: OrderTargetId }
  | { kind: "ignore" };

export type OrderColumnMapping = {
  header: string;
  index: number;
  target: OrderColumnTarget;
  dateOrder?: DateOrder;
};

/**
 * Unknown columns are IGNORED here, unlike the customer import where they
 * become custom fields. An order has nowhere to put an arbitrary column, and
 * inventing one per unrecognised POS column would fill the segment builder
 * with noise.
 */
export function autoMapOrderColumns(table: CsvTable): OrderColumnMapping[] {
  const used = new Set<OrderTargetId>();

  return table.headers.map((header, index) => {
    const key = normalizeHeader(header);
    let target: OrderColumnTarget = { kind: "ignore" };

    if (key) {
      for (const id of ORDER_ALIAS_ORDER) {
        if (used.has(id)) continue;
        if (key === normalizeHeader(id) || ORDER_ALIASES[id].includes(key)) {
          target = { kind: "builtin", id };
          used.add(id);
          break;
        }
      }
    }

    const mapping: OrderColumnMapping = { header, index, target };
    if (target.kind === "builtin" && target.id === "ordered_at")
      mapping.dateOrder = inferDateOrder(columnValues(table, index));
    return mapping;
  });
}

// --- Row parsing --------------------------------------------------------------

export type ParsedLine = {
  rowNumber: number; // 1-based CSV line, so an error names the line the user sees
  ref: string | null;
  date: string | null;
  time: string | null;
  email: string | null;
  phone: string | null;
  firstName: string;
  lastName: string;
  itemName: string | null;
  quantity: number;
  unitPriceCents: number | null;
  lineTotalCents: number | null;
  discountCents: number;
  orderTotalCents: number | null;
  paymentMethod: string | null;
  status: ImportedStatus;
  rawStatus: string | null;
  statusRecognised: boolean;
  staff: string | null;
  errors: string[];
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const FUTURE_GRACE_MS = 36 * 60 * 60 * 1000; // a day and a half of timezone slack

export function parseOrderLines(
  table: CsvTable,
  mappings: OrderColumnMapping[],
  now: number = Date.now(),
): ParsedLine[] {
  const byId = new Map<OrderTargetId, OrderColumnMapping>();
  for (const m of mappings)
    if (m.target.kind === "builtin") byId.set(m.target.id, m);

  const cellOf = (row: string[], id: OrderTargetId): string | null => {
    const m = byId.get(id);
    if (!m) return null;
    const v = (row[m.index] ?? "").trim();
    return v === "" ? null : v;
  };

  const dateOrder = byId.get("ordered_at")?.dateOrder ?? "iso";
  const hasQuantityColumn = byId.has("quantity");

  return table.rows.map((row, i) => {
    const errors: string[] = [];
    const rowNumber = i + 2; // +1 for 0-index, +1 for the header line

    const dateRaw = cellOf(row, "ordered_at");
    let date: string | null = null;
    if (!dateRaw) {
      errors.push("No date — an order without a date can't be placed in history");
    } else {
      date = parseDateValue(dateRaw, dateOrder);
      if (!date) errors.push(`Date isn't one we can read: "${dateRaw}"`);
    }

    // The time may be its own column or ride along in the date cell
    // ("2024-07-27 11:28:25"), which is how plenty of exports write it.
    const time = parseTimeOfDay(cellOf(row, "ordered_time")) ??
      (dateRaw ? parseTimeOfDay(dateRaw.slice(10)) : null);

    const emailRaw = cellOf(row, "customer_email");
    let email: string | null = null;
    if (emailRaw) {
      const candidate = emailRaw.toLowerCase();
      // An unreadable email is not worth failing an order over — the order is
      // still real revenue. It just can't be attributed, so it's dropped to
      // "no reference" and reported as unmatched rather than as an error.
      if (EMAIL_RE.test(candidate)) email = candidate;
    }

    const phoneRaw = cellOf(row, "customer_phone");
    const phone = phoneRaw ? normalizePhone(phoneRaw) : null;

    // A missing name is not a row error: the order is still real revenue and
    // still attaches by phone or email. It only rules the row out of CREATING a
    // customer, which resolveOrders reports separately.
    let firstName = cellOf(row, "customer_first_name") ?? "";
    let lastName = cellOf(row, "customer_last_name") ?? "";
    const fullName = cellOf(row, "customer_name");
    if (fullName && !firstName && !lastName) {
      const split = splitFullName(fullName);
      firstName = split.first;
      lastName = split.last;
    }

    const itemName = cellOf(row, "item_name");

    const qtyRaw = cellOf(row, "quantity");
    let quantity = 1;
    if (qtyRaw != null) {
      const n = Number(qtyRaw.replace(/,/g, ""));
      if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0)
        errors.push(`Quantity isn't a whole number above zero: "${qtyRaw}"`);
      else quantity = n;
    }

    const unitPriceCents = parseMoneyCents(cellOf(row, "unit_price"));
    const lineTotalCents = parseMoneyCents(cellOf(row, "line_total"));
    const orderTotalCents = parseMoneyCents(cellOf(row, "order_total"));
    const discountCents = parseMoneyCents(cellOf(row, "discount")) ?? 0;

    // Negative money is a refund line in most exports. total_cents and
    // unit_price_cents are both `>= 0` in the schema, so importing one would
    // fail the whole write chunk — reject the row with a reason instead.
    for (const [label, cents] of [
      ["Unit price", unitPriceCents],
      ["Line total", lineTotalCents],
      ["Order total", orderTotalCents],
      ["Discount", discountCents],
    ] as const)
      if (cents != null && cents < 0)
        errors.push(`${label} is negative — refund lines aren't imported`);

    const rawStatus = cellOf(row, "status");
    const { status, recognised } = readStatus(rawStatus);

    if (date) {
      const t = Date.parse(`${date}T12:00:00Z`);
      if (t - now > FUTURE_GRACE_MS)
        errors.push(`Date is in the future: "${dateRaw}"`);
    }

    return {
      rowNumber,
      ref: cellOf(row, "order_ref"),
      date,
      time,
      email,
      phone,
      firstName,
      lastName,
      itemName,
      quantity: hasQuantityColumn ? quantity : 1,
      unitPriceCents,
      lineTotalCents,
      discountCents,
      orderTotalCents,
      paymentMethod: cellOf(row, "payment_method"),
      status,
      rawStatus,
      statusRecognised: recognised,
      staff: cellOf(row, "staff"),
      errors,
    };
  });
}

// --- Grouping lines into orders -----------------------------------------------

export type DraftLine = {
  itemName: string;
  quantity: number;
  unitPriceCents: number;
};

export type DraftOrder = {
  importRef: string;
  /** True when we synthesised the key because the file had no receipt number. */
  generatedRef: boolean;
  rowNumbers: number[];
  at: string; // ISO UTC
  email: string | null;
  phone: string | null;
  /** Blank when the file has no name column — the order still imports. */
  firstName: string;
  lastName: string;
  status: ImportedStatus;
  paymentMethod: string | null;
  staff: string | null;
  totalCents: number;
  discountCents: number;
  lines: DraftLine[];
};

// 64 bits of hash, as two independent 32-bit mixes. One 32-bit hash collides
// with ~0.3% probability across 5,000 orders, and a collision here means a
// real order silently skipped as "already imported".
function hash64(s: string): string {
  let a = 0x811c9dc5;
  let b = 0xc2b2ae35;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193);
    b = Math.imul(b ^ c, 0x85ebca6b);
    b ^= b >>> 13;
  }
  return (
    (a >>> 0).toString(16).padStart(8, "0") +
    (b >>> 0).toString(16).padStart(8, "0")
  );
}

/**
 * Collapses line rows into orders.
 *
 * Grouping key, in order of preference:
 *  1. the file's own receipt number — the only one that survives the file
 *     being re-exported with different row ordering;
 *  2. customer + exact timestamp, when there's no receipt column but there is
 *     a clock to separate one visit from the next;
 *  3. nothing — each row becomes its own single-line order. This is the case
 *     for anonymous rows with a date but no time, where any shared key would
 *     merge a whole day's walk-ins into one giant receipt.
 */
export function groupIntoOrders(
  lines: ParsedLine[],
  offsetMinutes: number,
): { orders: DraftOrder[]; errored: ParsedLine[] } {
  const errored: ParsedLine[] = [];
  const buckets = new Map<string, ParsedLine[]>();
  const order: string[] = [];

  for (const line of lines) {
    if (line.errors.length > 0 || !line.date) {
      errored.push(line);
      continue;
    }
    const key = line.ref
      ? `ref:${line.ref}`
      : (line.email || line.phone) && line.time
        ? `k:${line.email ?? ""}|${line.phone ?? ""}|${line.date}T${line.time}`
        : `row:${line.rowNumber}`;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(line);
    else {
      buckets.set(key, [line]);
      order.push(key);
    }
  }

  const orders = order.map((key) => {
    const group = buckets.get(key)!;
    const head = group[0];
    const at = toTimestamp(head.date!, head.time, offsetMinutes);

    const lineRows: DraftLine[] = [];
    let lineSum = 0;
    let discount = 0;
    for (const l of group) {
      discount += l.discountCents;
      // Net first: it's what the customer was actually charged for the line,
      // and it already has the discount taken off. Falling back to
      // qty × price − discount reconstructs the same figure when the export
      // only gives gross.
      const net =
        l.lineTotalCents ??
        (l.unitPriceCents != null
          ? Math.max(0, l.unitPriceCents * l.quantity - l.discountCents)
          : null);
      if (net != null) lineSum += net;
      if (l.itemName)
        lineRows.push({
          itemName: l.itemName,
          quantity: l.quantity,
          // unit_price_cents is the per-unit figure the schema asks for;
          // derive it from the net when the file only has line totals.
          unitPriceCents:
            l.unitPriceCents ??
            (net != null ? Math.round(net / l.quantity) : 0),
        });
    }

    // An order-total column repeats on every line of a receipt in most
    // exports, so it is read once rather than summed.
    const stated = group.find((l) => l.orderTotalCents != null)?.orderTotalCents;
    const totalCents = stated ?? lineSum;

    // Cancelled wins: if any line of a receipt is voided or refunded, the
    // receipt is not counted as a purchase. The cautious direction — a
    // wrongly-counted sale inflates spend and moves a lifecycle stage.
    const status: ImportedStatus = group.some((l) => l.status === "cancelled")
      ? "cancelled"
      : "completed";

    const email = group.find((l) => l.email)?.email ?? null;
    const phone = group.find((l) => l.phone)?.phone ?? null;

    // First non-blank wins, and the surname is taken independently: exports
    // that repeat the customer on every line sometimes fill the name on one row
    // only, and a receipt reading "Priya" on one line and "Priya Nair" on the
    // next should end up as "Priya Nair".
    const firstName = group.find((l) => l.firstName)?.firstName ?? "";
    const lastName = group.find((l) => l.lastName)?.lastName ?? "";

    const generatedRef = !head.ref;
    const importRef = head.ref
      ? head.ref
      : // Prefixed so a synthesised key can never be confused with — or collide
        // with — a real receipt number from a later import.
        `auto:${hash64(
          `${email ?? ""}|${phone ?? ""}|${at}|${totalCents}|${lineRows[0]?.itemName ?? ""}`,
        )}`;

    return {
      importRef,
      generatedRef,
      rowNumbers: group.map((l) => l.rowNumber),
      at,
      email,
      phone,
      firstName,
      lastName,
      status,
      paymentMethod: group.find((l) => l.paymentMethod)?.paymentMethod ?? null,
      staff: group.find((l) => l.staff)?.staff ?? null,
      totalCents,
      discountCents: discount,
      lines: lineRows,
    } satisfies DraftOrder;
  });

  return { orders, errored };
}

// --- Customer resolution ------------------------------------------------------

export type ExistingCustomerRef = {
  id: string;
  phone: string | null;
  email: string | null;
};

/** What to do with an order we can't attach to a customer on file. */
export type UnmatchedPolicy = "skip" | "unattached";

export type SkipReason =
  | "already_imported"
  | "duplicate_in_file"
  | "no_customer_match"
  | "walk_in"
  // Sprint 48, and only reachable when createCustomers is on:
  | "no_name_to_create"
  | "ambiguous_identity";

export type OrderOutcome =
  | {
      kind: "create";
      customerId: string | null;
      /** Set when this order belongs to a customer the import will create. */
      newCustomerKey: string | null;
    }
  | { kind: "skip"; reason: SkipReason }
  | { kind: "conflict"; emailCustomerId: string; phoneCustomerId: string };

export type ResolvedOrder = { order: DraftOrder; outcome: OrderOutcome };

/**
 * A customer the file describes who isn't on file yet. Sprint 48 — a shop whose
 * only export is a POS file previously had no way in at all.
 */
export type DraftCustomer = {
  /** Stable within one file; the order outcomes point at it. */
  key: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  /**
   * Their earliest receipt in the file, cancelled ones included — they walked
   * in that day either way. Deliberately not the import date: that would put a
   * fake spike on the growth chart and make the `signed_up` criterion useless,
   * which is exactly what already happens to Klaviyo exports.
   */
  createdAt: string;
  orderCount: number;
};

export type ResolveResult = {
  resolved: ResolvedOrder[];
  newCustomers: DraftCustomer[];
};

// Identity tokens, so a person who gave an email on one receipt and a phone on
// another isn't created twice. Union-find rather than a single key because the
// link is transitive: (email, phone) on one receipt joins every later receipt
// carrying either one.
function makeUnionFind() {
  const parent = new Map<string, string>();
  const add = (x: string) => {
    if (!parent.has(x)) parent.set(x, x);
  };
  const find = (x: string): string => {
    let root = x;
    while (parent.get(root) !== root) root = parent.get(root)!;
    let cur = x;
    while (parent.get(cur) !== root) {
      const next = parent.get(cur)!;
      parent.set(cur, root);
      cur = next;
    }
    return root;
  };
  const union = (a: string, b: string) => {
    add(a);
    add(b);
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(rb, ra);
  };
  return { add, find, union };
}

export function resolveOrders(
  orders: DraftOrder[],
  existing: ExistingCustomerRef[],
  existingRefs: Iterable<string>,
  policy: UnmatchedPolicy,
  createCustomers = false,
): ResolveResult {
  const byPhone = new Map<string, string>();
  const byEmail = new Map<string, string>();
  for (const c of existing) {
    const p = c.phone ? normalizePhone(c.phone) : null;
    if (p && !byPhone.has(p)) byPhone.set(p, c.id);
    const e = c.email?.trim().toLowerCase();
    if (e && !byEmail.has(e)) byEmail.set(e, c.id);
  }

  const already = new Set(existingRefs);
  const seenInFile = new Set<string>();

  type Pre =
    | { k: "skip"; reason: "already_imported" | "duplicate_in_file" }
    | { k: "matched"; customerId: string }
    | { k: "conflict"; emailCustomerId: string; phoneCustomerId: string }
    | { k: "unmatched" } // carries a reference that matches nobody on file
    | { k: "walkin" }; // no customer reference at all

  const pre: Pre[] = orders.map((order) => {
    if (already.has(order.importRef)) return { k: "skip", reason: "already_imported" };
    if (seenInFile.has(order.importRef)) return { k: "skip", reason: "duplicate_in_file" };
    seenInFile.add(order.importRef);

    const viaEmail = order.email ? (byEmail.get(order.email) ?? null) : null;
    const viaPhone = order.phone ? (byPhone.get(order.phone) ?? null) : null;

    // Shared handsets, counter typos and recycled numbers all produce a
    // receipt whose email is one customer and whose phone is another. This is
    // the one case where guessing misattributes revenue silently — and a
    // wrongly-attached order also moves that customer's last visit, which can
    // flip their lifecycle stage. So the importer refuses to pick a side and
    // reports the row instead. Sprint 48's merge tool is what resolves these.
    if (viaEmail && viaPhone && viaEmail !== viaPhone)
      return { k: "conflict", emailCustomerId: viaEmail, phoneCustomerId: viaPhone };

    const customerId = viaEmail ?? viaPhone;
    if (customerId) return { k: "matched", customerId };
    return order.email || order.phone ? { k: "unmatched" } : { k: "walkin" };
  });

  // --- Who could we create? ----------------------------------------------------
  const uf = makeUnionFind();
  const memberIndexes = new Map<string, number[]>();
  if (createCustomers) {
    for (let i = 0; i < orders.length; i++) {
      if (pre[i].k !== "unmatched") continue;
      const o = orders[i];
      const eTok = o.email ? `e:${o.email}` : null;
      const pTok = o.phone ? `p:${o.phone}` : null;
      if (eTok && pTok) uf.union(eTok, pTok);
      else uf.add((eTok ?? pTok)!);
    }
    for (let i = 0; i < orders.length; i++) {
      if (pre[i].k !== "unmatched") continue;
      const o = orders[i];
      const root = uf.find(o.email ? `e:${o.email}` : `p:${o.phone}`);
      const list = memberIndexes.get(root);
      if (list) list.push(i);
      else memberIndexes.set(root, [i]);
    }
  }

  const draftByRoot = new Map<string, DraftCustomer>();
  const refusalByRoot = new Map<string, "no_name_to_create" | "ambiguous_identity">();

  for (const [root, indexes] of memberIndexes) {
    const emails = new Set<string>();
    const phones = new Set<string>();
    for (const i of indexes) {
      if (orders[i].email) emails.add(orders[i].email!);
      if (orders[i].phone) phones.add(orders[i].phone!);
    }

    // Two emails on one phone (or the reverse) is a shared handset or a
    // recycled number, not one person. Creating a record here would invent the
    // exact duplicate the merge tool then has to clean up, so it refuses for
    // the same reason the conflict branch above does.
    if (emails.size > 1 || phones.size > 1) {
      refusalByRoot.set(root, "ambiguous_identity");
      continue;
    }

    const named = indexes.find((i) => orders[i].firstName.trim() !== "");
    if (named === undefined) {
      // first_name and last_name are both NOT NULL, and a record with no name
      // is unusable in every screen that lists people.
      refusalByRoot.set(root, "no_name_to_create");
      continue;
    }

    let createdAt = orders[indexes[0]].at;
    for (const i of indexes)
      if (Date.parse(orders[i].at) < Date.parse(createdAt)) createdAt = orders[i].at;

    draftByRoot.set(root, {
      key: root,
      firstName: orders[named].firstName,
      lastName: orders[indexes.find((i) => orders[i].lastName.trim() !== "") ?? named].lastName,
      email: [...emails][0] ?? null,
      phone: [...phones][0] ?? null,
      createdAt,
      orderCount: indexes.length,
    });
  }

  const resolved: ResolvedOrder[] = orders.map((order, i) => {
    const p = pre[i];
    if (p.k === "skip") return { order, outcome: { kind: "skip", reason: p.reason } as const };
    if (p.k === "conflict")
      return {
        order,
        outcome: {
          kind: "conflict",
          emailCustomerId: p.emailCustomerId,
          phoneCustomerId: p.phoneCustomerId,
        } as const,
      };
    if (p.k === "matched")
      return {
        order,
        outcome: { kind: "create", customerId: p.customerId, newCustomerKey: null } as const,
      };

    if (p.k === "unmatched") {
      const root = uf.find(order.email ? `e:${order.email}` : `p:${order.phone}`);
      const draft = draftByRoot.get(root);
      if (draft)
        return {
          order,
          outcome: { kind: "create", customerId: null, newCustomerKey: draft.key } as const,
        };
      // Couldn't create them, so fall back to exactly what the file's own
      // policy said to do — but report WHY when it ends up skipped, since
      // "no match" and "we didn't have a name for them" are different problems
      // with different fixes.
      if (policy === "unattached")
        return {
          order,
          outcome: { kind: "create", customerId: null, newCustomerKey: null } as const,
        };
      return {
        order,
        outcome: {
          kind: "skip",
          reason: refusalByRoot.get(root) ?? "no_customer_match",
        } as const,
      };
    }

    // Walk-in: no customer on the receipt at all. Nothing to create from.
    return policy === "unattached"
      ? { order, outcome: { kind: "create", customerId: null, newCustomerKey: null } as const }
      : { order, outcome: { kind: "skip", reason: "walk_in" } as const };
  });

  return { resolved, newCustomers: [...draftByRoot.values()] };
}

// --- Item matching ------------------------------------------------------------

export type CatalogItem = { id: string; name: string };

function itemKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Matches a line's item name against the menu, case- and whitespace-insensitively.
 *
 * An unmatched name is NOT an error and NOT a new menu item: order_items.item_id
 * is nullable and item_name is not, so the name is kept as free text. That makes
 * "ever bought X" and "favourite item" work on day one without a year of
 * discontinued specials landing in the live menu.
 */
export function buildItemIndex(catalog: CatalogItem[]): Map<string, string> {
  const index = new Map<string, string>();
  for (const item of catalog) {
    const k = itemKey(item.name);
    if (k && !index.has(k)) index.set(k, item.id);
  }
  return index;
}

export function matchItem(
  name: string,
  index: Map<string, string>,
): string | null {
  return index.get(itemKey(name)) ?? null;
}

// --- Preview summary ----------------------------------------------------------

export type OrderImportSummary = {
  rows: number;
  orders: number;
  create: number;
  skipAlreadyImported: number;
  skipDuplicateInFile: number;
  skipNoCustomerMatch: number;
  skipWalkIn: number;
  skipNoNameToCreate: number;
  skipAmbiguousIdentity: number;
  conflicts: number;
  rowErrors: number;
  attachedToCustomers: number;
  /** Customers the import will create, and the orders landing on them. */
  newCustomers: number;
  attachedToNewCustomers: number;
  unattached: number;
  cancelled: number;
  revenueCents: number;
  customersTouched: number;
  generatedRefs: number;
  /** Status words the file used that we didn't recognise, so the preview can name them. */
  unknownStatuses: string[];
  unmatchedItems: string[];
};

export function summarizeOrders(
  resolved: ResolvedOrder[],
  errored: ParsedLine[],
  lines: ParsedLine[],
  itemIndex: Map<string, string>,
  newCustomers: DraftCustomer[] = [],
): OrderImportSummary {
  const touched = new Set<string>();
  const unknownStatuses = new Set<string>();
  const unmatchedItems = new Set<string>();

  for (const l of lines)
    if (!l.statusRecognised && l.rawStatus) unknownStatuses.add(l.rawStatus);

  const summary: OrderImportSummary = {
    rows: lines.length,
    orders: resolved.length,
    create: 0,
    skipAlreadyImported: 0,
    skipDuplicateInFile: 0,
    skipNoCustomerMatch: 0,
    skipWalkIn: 0,
    skipNoNameToCreate: 0,
    skipAmbiguousIdentity: 0,
    conflicts: 0,
    rowErrors: errored.length,
    attachedToCustomers: 0,
    newCustomers: newCustomers.length,
    attachedToNewCustomers: 0,
    unattached: 0,
    cancelled: 0,
    revenueCents: 0,
    customersTouched: 0,
    generatedRefs: 0,
    unknownStatuses: [...unknownStatuses].slice(0, 8),
    unmatchedItems: [],
  };

  for (const { order, outcome } of resolved) {
    if (outcome.kind === "conflict") {
      summary.conflicts += 1;
      continue;
    }
    if (outcome.kind === "skip") {
      if (outcome.reason === "already_imported") summary.skipAlreadyImported += 1;
      else if (outcome.reason === "duplicate_in_file") summary.skipDuplicateInFile += 1;
      else if (outcome.reason === "no_customer_match") summary.skipNoCustomerMatch += 1;
      else if (outcome.reason === "no_name_to_create") summary.skipNoNameToCreate += 1;
      else if (outcome.reason === "ambiguous_identity") summary.skipAmbiguousIdentity += 1;
      else summary.skipWalkIn += 1;
      continue;
    }

    summary.create += 1;
    if (order.generatedRef) summary.generatedRefs += 1;
    if (outcome.customerId) {
      summary.attachedToCustomers += 1;
      touched.add(outcome.customerId);
    } else if (outcome.newCustomerKey) {
      summary.attachedToNewCustomers += 1;
      // Counted alongside existing customers: "customers touched" is what the
      // done screen reports, and a customer created by this run is as touched
      // as one it found.
      touched.add(outcome.newCustomerKey);
    } else summary.unattached += 1;
    if (order.status === "cancelled") summary.cancelled += 1;
    // Only completed orders are revenue — cancelled ones are history that
    // buildProfiles deliberately ignores, so showing them here would promise
    // a number the dashboard won't agree with.
    else summary.revenueCents += order.totalCents;

    for (const line of order.lines)
      if (!matchItem(line.itemName, itemIndex)) unmatchedItems.add(line.itemName);
  }

  summary.customersTouched = touched.size;
  summary.unmatchedItems = [...unmatchedItems];
  return summary;
}
