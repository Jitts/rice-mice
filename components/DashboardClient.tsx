"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { formatCents } from "@/lib/format";
import { isActiveStatus, orderSummary, STATUS_STYLES, type Order } from "@/lib/orders";
import { InfoTip } from "@/components/InfoTip";
import { glossaryById } from "@/lib/glossary";
import { earnedPoints, type LoyaltyConfig } from "@/lib/loyalty";
import { useLoyalty, useRules } from "@/components/RulesContext";
import { SuggestedActions, type SegmentStub } from "@/components/SuggestedActions";
import { ActionInbox, type InboxAction } from "@/components/ActionInbox";

export type Customer = {
  id: string;
  first_name: string;
  last_name: string;
  phone: string | null;
  email: string | null;
  whatsapp_opt_in: boolean;
  email_opt_in: boolean;
  birthday: string | null;
  unsubscribe_token: string | null;
  created_at: string;
  last_purchase_date: string | null;
  tags: string[] | null;
  custom_fields: Record<string, unknown> | null;
};

export type CustomFieldDef = {
  key: string;
  label: string;
  value_type: "text" | "number" | "boolean" | "date";
};

function customerName(customers: Customer[], customerId: string | null) {
  if (!customerId) return "Walk-in";
  const c = customers.find((c) => c.id === customerId);
  return c ? `${c.first_name} ${c.last_name}` : "Unknown";
}

const DAY_MS = 24 * 60 * 60 * 1000;

// Loyalty counts *completed* orders only — cancelled and in-progress orders
// don't earn a customer any standing.
function withLoyalty(
  customers: Customer[],
  orders: Order[],
  atRiskDays: number,
  config: LoyaltyConfig,
) {
  const statsByCustomer = new Map<string, { count: number; totalCents: number }>();
  for (const o of orders) {
    if (o.status !== "completed" || !o.customer_id) continue;
    const stats = statsByCustomer.get(o.customer_id) ?? {
      count: 0,
      totalCents: 0,
    };
    stats.count += 1;
    stats.totalCents += o.total_cents ?? 0;
    statsByCustomer.set(o.customer_id, stats);
  }

  return customers
    .map((c) => {
      const stats = statsByCustomer.get(c.id) ?? { count: 0, totalCents: 0 };
      const loyaltyScore = earnedPoints(stats.count, stats.totalCents, config);
      const atRisk =
        loyaltyScore > 0 &&
        !!c.last_purchase_date &&
        Date.now() - new Date(c.last_purchase_date).getTime() > atRiskDays * DAY_MS;
      return { ...c, loyaltyScore, atRisk };
    })
    .sort((a, b) => b.loyaltyScore - a.loyaltyScore);
}

export function DashboardClient({
  initialCustomers,
  initialOrders,
  customFieldDefs = [],
  segments = [],
  inboxActions = [],
  emailReady = false,
}: {
  initialCustomers: Customer[];
  initialOrders: Order[];
  customFieldDefs?: CustomFieldDef[];
  segments?: SegmentStub[];
  inboxActions?: InboxAction[];
  emailReady?: boolean;
}) {
  const [customers, setCustomers] = useState(initialCustomers);
  const [orders] = useState(initialOrders);
  const rules = useRules();
  const loyalty = useLoyalty();
  const glossary = useMemo(() => glossaryById(rules, loyalty), [rules, loyalty]);

  const rankedCustomers = useMemo(
    () => withLoyalty(customers, orders, rules.at_risk_days, loyalty),
    [customers, orders, rules, loyalty],
  );

  const stats = useMemo(() => {
    const completed = orders.filter((o) => o.status === "completed");
    return {
      customers: customers.length,
      activeOrders: orders.filter((o) => isActiveStatus(o.status)).length,
      completedOrders: completed.length,
      revenueCents: completed.reduce((sum, o) => sum + (o.total_cents ?? 0), 0),
    };
  }, [customers, orders]);

  // Tags are a segmentation criterion; staff maintain them here. Optimistic
  // update, then persist.
  async function updateTags(id: string, tags: string[]) {
    setCustomers((cs) => cs.map((c) => (c.id === id ? { ...c, tags } : c)));
    const supabase = createClient();
    await supabase.from("customers").update({ tags }).eq("id", id);
  }

  // Custom criteria (staff-defined in Segments) store their per-customer values
  // here, so a criterion becomes usable the moment it's created.
  async function updateCustomFields(id: string, values: Record<string, unknown>) {
    setCustomers((cs) => cs.map((c) => (c.id === id ? { ...c, custom_fields: values } : c)));
    const supabase = createClient();
    await supabase.from("customers").update({ custom_fields: values }).eq("id", id);
  }

  return (
    <div className="max-w-5xl mx-auto space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="font-heading text-2xl font-bold tracking-tight">Dashboard</h1>
        <Link
          href="/dashboard/orders"
          className="text-sm bg-primary text-primary-foreground rounded-lg px-4 py-2 hover:bg-primary/90"
        >
          New order
        </Link>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Sign-ups" value={String(stats.customers)} />
        <StatCard label="Active orders" value={String(stats.activeOrders)} tip="order_status" />
        <StatCard label="Completed orders" value={String(stats.completedOrders)} />
        <StatCard label="Revenue" value={formatCents(stats.revenueCents)} tip="revenue" />
      </div>

      <ActionInbox initialActions={inboxActions} emailReady={emailReady} />

      <SuggestedActions
        customers={customers}
        orders={orders}
        segments={segments}
      />

      <section>
        <h2 className="text-lg font-semibold mb-3">Sign-ups</h2>
        {rankedCustomers.length === 0 ? (
          <p className="text-muted-foreground">
            No sign-ups yet. Share your QR code!
          </p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border bg-card">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b border-border bg-muted text-muted-foreground">
                  <th className="px-4 py-2.5 font-medium">Name</th>
                  <th className="px-4 py-2.5 font-medium">Phone</th>
                  <th className="px-4 py-2.5 font-medium">WhatsApp</th>
                  <th className="px-4 py-2.5 font-medium">Signed up</th>
                  <th
                    className="px-4 py-2.5 font-medium underline decoration-dotted decoration-neutral-300 underline-offset-2 cursor-help"
                    title={`${glossary.loyalty.short} ${glossary.loyalty.how}`}
                  >
                    Loyalty
                  </th>
                  <th className="px-4 py-2.5 font-medium">Tags</th>
                  {customFieldDefs.length > 0 && (
                    <th className="px-4 py-2.5 font-medium">Custom fields</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {rankedCustomers.map((c) => (
                  <tr
                    key={c.id}
                    className="border-b border-border/60 last:border-0 hover:bg-muted"
                  >
                    <td className="px-4 py-2.5">
                      <Link
                        href={`/dashboard/customers/${c.id}`}
                        className="font-medium hover:underline"
                      >
                        {c.first_name} {c.last_name}
                      </Link>
                      {c.atRisk && (
                        <span
                          className="ml-2 text-xs bg-destructive/10 text-destructive rounded px-1.5 py-0.5 cursor-help"
                          title={`${glossary.at_risk.short} ${glossary.at_risk.how}`}
                        >
                          At Risk
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5">{c.phone ?? "-"}</td>
                    <td className="px-4 py-2.5">{c.whatsapp_opt_in ? "Yes" : "No"}</td>
                    <td className="px-4 py-2.5">
                      {new Date(c.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-2.5">{c.loyaltyScore}</td>
                    <td className="px-4 py-2.5">
                      <TagCell
                        tags={c.tags ?? []}
                        onChange={(t) => updateTags(c.id, t)}
                      />
                    </td>
                    {customFieldDefs.length > 0 && (
                      <td className="px-4 py-2.5">
                        <CustomFieldsCell
                          defs={customFieldDefs}
                          values={c.custom_fields ?? {}}
                          onChange={(v) => updateCustomFields(c.id, v)}
                        />
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-3">Orders</h2>
        {orders.length === 0 ? (
          <p className="text-muted-foreground">
            No orders yet.{" "}
            <Link href="/dashboard/orders" className="underline">
              Take your first order.
            </Link>
          </p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border bg-card">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b border-border bg-muted text-muted-foreground">
                  <th className="px-4 py-2.5 font-medium">Order</th>
                  <th className="px-4 py-2.5 font-medium">Customer</th>
                  <th className="px-4 py-2.5 font-medium">Items</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                  <th className="px-4 py-2.5 font-medium">Amount</th>
                  <th className="px-4 py-2.5 font-medium">Date</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => (
                  <tr
                    key={o.id}
                    className="border-b border-border/60 last:border-0 hover:bg-muted"
                  >
                    <td className="px-4 py-2.5 font-medium">
                      <Link
                        href={`/dashboard/orders/${o.id}`}
                        className="hover:underline"
                      >
                        #{o.order_no}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5">
                      {(() => {
                        const c = o.customer_id
                          ? customers.find((x) => x.id === o.customer_id)
                          : null;
                        return c ? (
                          <Link
                            href={`/dashboard/customers/${c.id}`}
                            className="hover:underline"
                          >
                            {c.first_name} {c.last_name}
                          </Link>
                        ) : (
                          customerName(customers, o.customer_id)
                        );
                      })()}
                    </td>
                    <td className="px-4 py-2.5 max-w-xs truncate">
                      {orderSummary(o) || "-"}
                    </td>
                    <td className="px-4 py-2.5">
                      <span
                        className={`text-xs rounded-full px-2 py-0.5 capitalize ${
                          STATUS_STYLES[o.status] ?? STATUS_STYLES.open
                        }`}
                      >
                        {o.status}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">{formatCents(o.total_cents)}</td>
                    <td className="px-4 py-2.5">
                      {new Date(o.created_at).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function StatCard({
  label,
  value,
  tip,
}: {
  label: string;
  value: string;
  tip?: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3">
      <p className="text-xs text-muted-foreground">
        {label}
        {tip && <InfoTip term={tip} align="left" />}
      </p>
      <p className="text-2xl font-semibold tracking-tight">{value}</p>
    </div>
  );
}

// Also used by the Customer 360 page — same editor, same optimistic pattern.
export function TagCell({
  tags,
  onChange,
}: {
  tags: string[];
  onChange: (tags: string[]) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [val, setVal] = useState("");

  function commit() {
    const t = val.trim();
    if (t && !tags.includes(t)) onChange([...tags, t]);
    setVal("");
    setAdding(false);
  }

  return (
    <div className="flex flex-wrap items-center gap-1">
      {tags.map((t) => (
        <span
          key={t}
          className="text-xs bg-muted rounded px-1.5 py-0.5 flex items-center gap-1"
        >
          {t}
          <button
            onClick={() => onChange(tags.filter((x) => x !== t))}
            className="text-muted-foreground/70 hover:text-destructive"
            aria-label={`Remove tag ${t}`}
          >
            ×
          </button>
        </span>
      ))}
      {adding ? (
        <input
          autoFocus
          value={val}
          onChange={(e) => setVal(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") {
              setVal("");
              setAdding(false);
            }
          }}
          placeholder="tag"
          className="w-20 border border-input rounded px-1 text-xs"
        />
      ) : (
        <button
          onClick={() => setAdding(true)}
          className="text-xs text-muted-foreground/70 hover:text-foreground/80"
        >
          + tag
        </button>
      )}
    </div>
  );
}

function displayValue(def: CustomFieldDef, raw: unknown): string {
  if (def.value_type === "boolean") return raw ? "Yes" : "No";
  return String(raw);
}

// Also used by the Customer 360 page.
export function CustomFieldsCell({
  defs,
  values,
  onChange,
}: {
  defs: CustomFieldDef[];
  values: Record<string, unknown>;
  onChange: (values: Record<string, unknown>) => void;
}) {
  const [adding, setAdding] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const isSet = (key: string) => {
    const v = values[key];
    return v !== undefined && v !== null && v !== "";
  };
  const set = defs.filter((d) => isSet(d.key));
  const unset = defs.filter((d) => !isSet(d.key));
  const addingDef = defs.find((d) => d.key === adding);

  function commit(key: string, value: unknown) {
    onChange({ ...values, [key]: value });
    setAdding(null);
    setDraft("");
  }
  function clear(key: string) {
    const next = { ...values };
    delete next[key];
    onChange(next);
  }

  return (
    <div className="flex flex-wrap items-center gap-1">
      {set.map((d) => (
        <span
          key={d.key}
          className="text-xs bg-violet-50 text-violet-700 rounded px-1.5 py-0.5 flex items-center gap-1"
        >
          {d.label}: {displayValue(d, values[d.key])}
          <button
            onClick={() => clear(d.key)}
            className="text-violet-400 hover:text-destructive"
            aria-label={`Clear ${d.label}`}
          >
            ×
          </button>
        </span>
      ))}
      {addingDef ? (
        addingDef.value_type === "boolean" ? (
          <span className="flex gap-1">
            <button
              onClick={() => commit(addingDef.key, true)}
              className="text-xs border border-input rounded px-1.5 py-0.5"
            >
              Yes
            </button>
            <button
              onClick={() => commit(addingDef.key, false)}
              className="text-xs border border-input rounded px-1.5 py-0.5"
            >
              No
            </button>
          </span>
        ) : (
          <input
            autoFocus
            type={
              addingDef.value_type === "number"
                ? "number"
                : addingDef.value_type === "date"
                  ? "date"
                  : "text"
            }
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => {
              if (!draft.trim()) return setAdding(null);
              commit(addingDef.key, addingDef.value_type === "number" ? Number(draft) : draft.trim());
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                commit(addingDef.key, addingDef.value_type === "number" ? Number(draft) : draft.trim());
              }
              if (e.key === "Escape") setAdding(null);
            }}
            className="w-24 border border-input rounded px-1 text-xs"
          />
        )
      ) : unset.length > 0 ? (
        <select
          value=""
          onChange={(e) => {
            if (e.target.value) setAdding(e.target.value);
          }}
          className="text-xs border border-input rounded bg-card text-muted-foreground/70"
        >
          <option value="">+ field</option>
          {unset.map((d) => (
            <option key={d.key} value={d.key}>
              {d.label}
            </option>
          ))}
        </select>
      ) : null}
    </div>
  );
}
