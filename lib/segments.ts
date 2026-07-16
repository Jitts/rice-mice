import type { Order } from "@/lib/orders";
import { DEFAULT_RULES, type MarketingRules } from "@/lib/marketing";

// --- Criteria tree ------------------------------------------------------------
// A segment definition is a recursive AND/OR tree. The visual canvas serialises
// straight to this shape and it is stored verbatim in segments.definition (jsonb).
// A tree node is either a leaf condition, a nested AND/OR group, or a reference
// to another saved segment (include/exclude) — that reference is how segments
// merge (OR two refs) or exclude one another (AND NOT a ref) without any new
// storage: it's just another node shape in the same jsonb tree.

export type Combinator = "all" | "any";
export type SegValue = string | number | null;

export type Condition = {
  type: "condition";
  field: string;
  op: string;
  value: SegValue;
};

export type Group = {
  type: "group";
  combinator: Combinator;
  children: SegmentNode[];
};

export type SegmentRefMode = "include" | "exclude";

export type SegmentRef = {
  type: "segment_ref";
  segmentId: string;
  mode: SegmentRefMode;
};

export type SegmentNode = Condition | Group | SegmentRef;
export type SegmentDefinition = Group;

export const EMPTY_DEFINITION: SegmentDefinition = {
  type: "group",
  combinator: "all",
  children: [],
};

// --- Derived customer profile -------------------------------------------------
// Everything the criteria can filter on, computed once from data we already load.

export type CustomerRow = {
  id: string;
  first_name: string;
  last_name: string;
  phone: string | null;
  email: string | null;
  whatsapp_opt_in: boolean;
  email_opt_in: boolean;
  sms_opt_in: boolean;
  tags: string[] | null;
  birthday: string | null;
  created_at: string;
  last_purchase_date: string | null;
  unsubscribe_token: string | null;
  custom_fields: Record<string, unknown> | null;
};

export type CustomerProfile = {
  id: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  email: string | null;
  whatsappOptIn: boolean;
  emailOptIn: boolean;
  smsOptIn: boolean;
  tags: string[];
  birthday: string | null;
  createdAt: string;
  unsubscribeToken: string | null;
  customFields: Record<string, unknown>;
  totalSpentCents: number;
  orderCount: number;
  avgOrderCents: number;
  lastVisit: string | null;
  favouriteItem: string | null;
  itemsPurchased: string[];
  paymentMethods: string[];
};

const DAY_MS = 24 * 60 * 60 * 1000;

function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  return Math.floor((Date.now() - new Date(iso).getTime()) / DAY_MS);
}

// Reachable = opted in on at least one marketing channel. A campaign never sends
// to a customer who is not reachable, so this drives the "opted-in" preview count.
export function isReachable(p: CustomerProfile): boolean {
  return p.whatsappOptIn || p.emailOptIn || p.smsOptIn;
}

export function buildProfiles(
  customers: CustomerRow[],
  orders: Order[],
): CustomerProfile[] {
  type Agg = {
    total: number;
    count: number;
    qtyByItem: Map<string, number>;
    items: Set<string>;
    payments: Set<string>;
    lastAt: number | null;
  };
  const agg = new Map<string, Agg>();

  for (const o of orders) {
    if (o.status !== "completed" || !o.customer_id) continue;
    const a =
      agg.get(o.customer_id) ??
      ({
        total: 0,
        count: 0,
        qtyByItem: new Map(),
        items: new Set(),
        payments: new Set(),
        lastAt: null,
      } satisfies Agg);
    a.total += o.total_cents ?? 0;
    a.count += 1;
    const at = new Date(o.created_at).getTime();
    a.lastAt = a.lastAt == null ? at : Math.max(a.lastAt, at);
    if (o.payment_method) a.payments.add(o.payment_method);
    for (const line of o.order_items ?? []) {
      a.items.add(line.item_name);
      a.qtyByItem.set(
        line.item_name,
        (a.qtyByItem.get(line.item_name) ?? 0) + line.quantity,
      );
    }
    agg.set(o.customer_id, a);
  }

  return customers.map((c) => {
    const a = agg.get(c.id);
    let favouriteItem: string | null = null;
    if (a && a.qtyByItem.size > 0) {
      let best = -1;
      for (const [name, qty] of a.qtyByItem) {
        if (qty > best) {
          best = qty;
          favouriteItem = name;
        }
      }
    }
    const count = a?.count ?? 0;
    const total = a?.total ?? 0;
    // Prefer the maintained last_purchase_date; fall back to newest completed order.
    const lastVisit =
      c.last_purchase_date ??
      (a?.lastAt != null ? new Date(a.lastAt).toISOString() : null);

    return {
      id: c.id,
      firstName: c.first_name,
      lastName: c.last_name,
      phone: c.phone,
      email: c.email,
      whatsappOptIn: !!c.whatsapp_opt_in,
      emailOptIn: !!c.email_opt_in,
      smsOptIn: !!c.sms_opt_in,
      tags: c.tags ?? [],
      birthday: c.birthday,
      createdAt: c.created_at,
      unsubscribeToken: c.unsubscribe_token,
      customFields: c.custom_fields ?? {},
      totalSpentCents: total,
      orderCount: count,
      avgOrderCents: count > 0 ? Math.round(total / count) : 0,
      lastVisit,
      favouriteItem,
      itemsPurchased: a ? [...a.items] : [],
      paymentMethods: a ? [...a.payments] : [],
    };
  });
}

// --- Field registry -----------------------------------------------------------
// Each field knows its operators and how to evaluate against a profile. The
// builder renders controls generically from this, so adding a criterion is one
// entry here — no UI changes. Custom (staff-defined) fields generate a FieldDef
// the same shape as the built-in ones, so the rest of the engine and the builder
// UI treat them identically.

export type FieldType =
  | "money"
  | "count"
  | "recency"
  | "signup"
  | "enum"
  | "item"
  | "tag"
  | "birthday"
  | "custom_text"
  | "custom_number"
  | "custom_boolean"
  | "custom_date";

export type OperatorDef = { id: string; label: string };

export type FieldDef = {
  id: string;
  label: string;
  icon: string; // tabler icon name (without the `ti ti-` prefix)
  type: FieldType;
  operators: OperatorDef[];
  defaultOp: string;
  defaultValue: SegValue;
  evaluate: (p: CustomerProfile, op: string, value: SegValue) => boolean;
  custom?: boolean; // true for staff-defined fields (drives a "custom" badge in the UI)
};

const num = (v: SegValue): number => (typeof v === "number" ? v : Number(v) || 0);
// Accepts `unknown` (not just SegValue) so it can also stringify raw
// customer.custom_fields jsonb values, which are unknown until read.
const str = (v: unknown): string => (v == null ? "" : String(v));

export const FIELDS: Record<string, FieldDef> = {
  total_spent: {
    id: "total_spent",
    label: "Total spent",
    icon: "coin",
    type: "money",
    operators: [
      { id: "gte", label: "is at least" },
      { id: "gt", label: "is over" },
      { id: "lt", label: "is under" },
    ],
    defaultOp: "gte",
    defaultValue: 50000,
    evaluate: (p, op, v) => {
      const c = num(v);
      if (op === "gt") return p.totalSpentCents > c;
      if (op === "lt") return p.totalSpentCents < c;
      return p.totalSpentCents >= c;
    },
  },
  avg_order: {
    id: "avg_order",
    label: "Average order",
    icon: "receipt",
    type: "money",
    operators: [
      { id: "gte", label: "is at least" },
      { id: "gt", label: "is over" },
      { id: "lt", label: "is under" },
    ],
    defaultOp: "gte",
    defaultValue: 10000,
    evaluate: (p, op, v) => {
      const c = num(v);
      if (op === "gt") return p.avgOrderCents > c;
      if (op === "lt") return p.avgOrderCents < c;
      return p.avgOrderCents >= c;
    },
  },
  order_count: {
    id: "order_count",
    label: "Order count",
    icon: "shopping-bag",
    type: "count",
    operators: [
      { id: "gte", label: "is at least" },
      { id: "gt", label: "is over" },
      { id: "lt", label: "is under" },
      { id: "eq", label: "is exactly" },
    ],
    defaultOp: "gte",
    defaultValue: 3,
    evaluate: (p, op, v) => {
      const n = num(v);
      if (op === "gt") return p.orderCount > n;
      if (op === "lt") return p.orderCount < n;
      if (op === "eq") return p.orderCount === n;
      return p.orderCount >= n;
    },
  },
  last_visit: {
    id: "last_visit",
    label: "Last visit",
    icon: "clock",
    type: "recency",
    operators: [
      { id: "before_days", label: "more than … days ago" },
      { id: "within_days", label: "within the last … days" },
    ],
    defaultOp: "before_days",
    defaultValue: 30,
    evaluate: (p, op, v) => {
      const d = daysSince(p.lastVisit);
      if (d == null) return false; // never visited → matches no recency window
      return op === "within_days" ? d <= num(v) : d > num(v);
    },
  },
  signed_up: {
    id: "signed_up",
    label: "Signed up",
    icon: "user-plus",
    type: "signup",
    operators: [
      { id: "within_days", label: "within the last … days" },
      { id: "before_days", label: "more than … days ago" },
    ],
    defaultOp: "within_days",
    defaultValue: 30,
    evaluate: (p, op, v) => {
      const d = daysSince(p.createdAt);
      if (d == null) return false;
      return op === "before_days" ? d > num(v) : d <= num(v);
    },
  },
  payment_method: {
    id: "payment_method",
    label: "Pays with",
    icon: "credit-card",
    type: "enum",
    operators: [
      { id: "is", label: "has used" },
      { id: "is_not", label: "has never used" },
    ],
    defaultOp: "is",
    defaultValue: "card",
    evaluate: (p, op, v) => {
      const has = p.paymentMethods.includes(str(v));
      return op === "is_not" ? !has : has;
    },
  },
  favourite_item: {
    id: "favourite_item",
    label: "Favourite item",
    icon: "star",
    type: "item",
    operators: [{ id: "is", label: "is" }],
    defaultOp: "is",
    defaultValue: "",
    evaluate: (p, _op, v) => p.favouriteItem === str(v),
  },
  ever_bought: {
    id: "ever_bought",
    label: "Ever bought",
    icon: "basket",
    type: "item",
    operators: [
      { id: "has", label: "has bought" },
      { id: "has_not", label: "has never bought" },
    ],
    defaultOp: "has",
    defaultValue: "",
    evaluate: (p, op, v) => {
      const has = p.itemsPurchased.includes(str(v));
      return op === "has_not" ? !has : has;
    },
  },
  tag: {
    id: "tag",
    label: "Tag",
    icon: "tag",
    type: "tag",
    operators: [
      { id: "has", label: "is" },
      { id: "not_has", label: "is not" },
    ],
    defaultOp: "has",
    defaultValue: "",
    evaluate: (p, op, v) => {
      const has = p.tags.includes(str(v));
      return op === "not_has" ? !has : has;
    },
  },
  birthday: {
    id: "birthday",
    label: "Birthday",
    icon: "cake",
    type: "birthday",
    operators: [{ id: "month_is", label: "is in" }],
    defaultOp: "month_is",
    defaultValue: new Date().getMonth() + 1,
    evaluate: (p, _op, v) => {
      if (!p.birthday) return false;
      return new Date(p.birthday).getUTCMonth() + 1 === num(v);
    },
  },
};

export const FIELD_LIST: FieldDef[] = Object.values(FIELDS);

// --- Custom (staff-defined) criteria -------------------------------------------
// A custom_fields row describes a field staff created (name + value type). Values
// live per-customer in customers.custom_fields (jsonb keyed by `key`). Each row
// compiles to a FieldDef with the same shape as the built-ins, so it drops
// straight into the builder's field registry with no special-casing downstream.

export type CustomFieldValueType = "text" | "number" | "boolean" | "date";

export type CustomFieldRow = {
  id: string;
  key: string;
  label: string;
  value_type: CustomFieldValueType;
  sort_order: number;
};

function customFieldToDef(row: CustomFieldRow): FieldDef {
  const base = { id: row.key, label: row.label, icon: "list-details", custom: true as const };

  if (row.value_type === "text") {
    return {
      ...base,
      type: "custom_text",
      operators: [
        { id: "is", label: "is" },
        { id: "is_not", label: "is not" },
        { id: "contains", label: "contains" },
      ],
      defaultOp: "is",
      defaultValue: "",
      evaluate: (p, op, v) => {
        const actual = str(p.customFields[row.key]);
        const target = str(v);
        if (op === "contains") return actual.toLowerCase().includes(target.toLowerCase());
        const eq = actual.toLowerCase() === target.toLowerCase();
        return op === "is_not" ? !eq : eq;
      },
    };
  }
  if (row.value_type === "number") {
    return {
      ...base,
      type: "custom_number",
      operators: [
        { id: "gte", label: "is at least" },
        { id: "gt", label: "is over" },
        { id: "lt", label: "is under" },
        { id: "eq", label: "is exactly" },
      ],
      defaultOp: "gte",
      defaultValue: 0,
      evaluate: (p, op, v) => {
        const raw = p.customFields[row.key];
        if (raw == null || raw === "") return false;
        const actual = Number(raw);
        const target = num(v);
        if (op === "gt") return actual > target;
        if (op === "lt") return actual < target;
        if (op === "eq") return actual === target;
        return actual >= target;
      },
    };
  }
  if (row.value_type === "boolean") {
    return {
      ...base,
      type: "custom_boolean",
      operators: [{ id: "is", label: "is" }],
      defaultOp: "is",
      defaultValue: "true",
      evaluate: (p, _op, v) => !!p.customFields[row.key] === (str(v) === "true"),
    };
  }
  // date
  return {
    ...base,
    type: "custom_date",
    operators: [
      { id: "on_or_after", label: "is on or after" },
      { id: "on_or_before", label: "is on or before" },
    ],
    defaultOp: "on_or_after",
    defaultValue: new Date().toISOString().slice(0, 10),
    evaluate: (p, op, v) => {
      const raw = p.customFields[row.key];
      if (!raw) return false;
      const actual = new Date(String(raw)).getTime();
      const target = new Date(str(v)).getTime();
      if (Number.isNaN(actual) || Number.isNaN(target)) return false;
      return op === "on_or_before" ? actual <= target : actual >= target;
    },
  };
}

// Merges the built-in fields with staff-defined custom fields into one registry
// the builder UI and the evaluator both read from.
export function buildFieldRegistry(customFieldRows: CustomFieldRow[]): {
  list: FieldDef[];
  byId: Record<string, FieldDef>;
} {
  const customDefs = [...customFieldRows]
    .sort((a, b) => a.sort_order - b.sort_order)
    .map(customFieldToDef);
  const byId: Record<string, FieldDef> = { ...FIELDS };
  for (const d of customDefs) byId[d.id] = d;
  return { list: [...FIELD_LIST, ...customDefs], byId };
}

export function newCondition(
  fieldId: string,
  fieldsById: Record<string, FieldDef> = FIELDS,
): Condition {
  const f = fieldsById[fieldId] ?? FIELDS[fieldId];
  return { type: "condition", field: fieldId, op: f.defaultOp, value: f.defaultValue };
}

export function newGroup(combinator: Combinator = "all"): Group {
  return { type: "group", combinator, children: [] };
}

export function newSegmentRef(segmentId: string, mode: SegmentRefMode = "include"): SegmentRef {
  return { type: "segment_ref", segmentId, mode };
}

// --- Evaluation ---------------------------------------------------------------
// A segment_ref node resolves by looking up the referenced segment's definition
// and evaluating it recursively; "exclude" negates the result. `visiting` guards
// against a segment (directly or transitively) referencing itself — a cycle
// resolves to "no match" for the repeated branch rather than recursing forever.

export function matchesNode(
  node: SegmentNode,
  p: CustomerProfile,
  fields: Record<string, FieldDef> = FIELDS,
  segmentsById: Record<string, SegmentDefinition> = {},
  visiting: ReadonlySet<string> = new Set(),
): boolean {
  if (node.type === "condition") {
    const f = fields[node.field];
    return f ? f.evaluate(p, node.op, node.value) : false;
  }
  if (node.type === "segment_ref") {
    if (!node.segmentId || visiting.has(node.segmentId)) return false;
    const ref = segmentsById[node.segmentId];
    if (!ref) return false; // referenced segment was deleted
    const nextVisiting = new Set(visiting);
    nextVisiting.add(node.segmentId);
    const result = matchesNode(ref, p, fields, segmentsById, nextVisiting);
    return node.mode === "exclude" ? !result : result;
  }
  if (node.children.length === 0) return true; // empty group matches everyone
  return node.combinator === "all"
    ? node.children.every((c) => matchesNode(c, p, fields, segmentsById, visiting))
    : node.children.some((c) => matchesNode(c, p, fields, segmentsById, visiting));
}

export function filterProfiles(
  def: SegmentDefinition,
  profiles: CustomerProfile[],
  fields: Record<string, FieldDef> = FIELDS,
  segmentsById: Record<string, SegmentDefinition> = {},
): CustomerProfile[] {
  return profiles.filter((p) => matchesNode(def, p, fields, segmentsById));
}

// --- Option lists for enum/item/tag controls ----------------------------------

export type OptionLists = {
  items: string[];
  tags: string[];
  paymentMethods: string[];
};

export function collectOptions(
  profiles: CustomerProfile[],
  itemNames: string[],
): OptionLists {
  const tags = new Set<string>();
  const payments = new Set<string>();
  const items = new Set<string>(itemNames);
  for (const p of profiles) {
    p.tags.forEach((t) => tags.add(t));
    p.paymentMethods.forEach((m) => payments.add(m));
    p.itemsPurchased.forEach((i) => items.add(i));
  }
  return {
    items: [...items].sort(),
    tags: [...tags].sort(),
    paymentMethods: [...payments].sort(),
  };
}

// --- Customer journey stages --------------------------------------------------
// Each customer sits in exactly one lifecycle stage. Thresholds mirror the
// existing loyalty/at-risk rules (30-day at-risk window) and add a churn cutoff.

export type JourneyStage = "new" | "active" | "loyal" | "at_risk" | "churned";

export const JOURNEY_ORDER: JourneyStage[] = [
  "new",
  "active",
  "loyal",
  "at_risk",
  "churned",
];

export const JOURNEY_LABELS: Record<JourneyStage, string> = {
  new: "New",
  active: "Active",
  loyal: "Loyal",
  at_risk: "At risk",
  churned: "Churned",
};

// Lifecycle thresholds live in the marketing rules (Settings → Marketing
// rules); the defaults are the numbers this engine originally shipped with.
// UI copy and the glossary quote the same rules object the engine computes
// with, so a definition can never drift from what the app actually does.
export function stageOf(
  p: CustomerProfile,
  rules: MarketingRules = DEFAULT_RULES,
): JourneyStage {
  if (p.orderCount === 0) return "new";
  const d = daysSince(p.lastVisit);
  if (d != null && d > rules.churn_days) return "churned";
  if (d != null && d > rules.at_risk_days) return "at_risk";
  if (p.orderCount >= rules.loyal_min_orders) return "loyal";
  return "active";
}

export function journeyCounts(
  profiles: CustomerProfile[],
  rules: MarketingRules = DEFAULT_RULES,
): Record<JourneyStage, number> {
  const counts: Record<JourneyStage, number> = {
    new: 0,
    active: 0,
    loyal: 0,
    at_risk: 0,
    churned: 0,
  };
  for (const p of profiles) counts[stageOf(p, rules)] += 1;
  return counts;
}
