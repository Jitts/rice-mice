"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { formatCents } from "@/lib/format";
import { orderSummary, STATUS_STYLES, type Order } from "@/lib/orders";

export type Customer = {
  id: string;
  first_name: string;
  last_name: string;
  phone: string | null;
  whatsapp_opt_in: boolean;
  created_at: string;
  loyalty_score: number;
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

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

// Loyalty counts *completed* orders only — cancelled and in-progress orders
// don't earn a customer any standing.
function withLoyalty(customers: Customer[], orders: Order[]) {
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
      const loyaltyScore = stats.count + Math.floor(stats.totalCents / 10000);
      const atRisk =
        loyaltyScore > 0 &&
        !!c.last_purchase_date &&
        Date.now() - new Date(c.last_purchase_date).getTime() > THIRTY_DAYS_MS;
      return { ...c, loyaltyScore, atRisk };
    })
    .sort((a, b) => b.loyaltyScore - a.loyaltyScore);
}

export function DashboardClient({
  initialCustomers,
  initialOrders,
  customFieldDefs = [],
}: {
  initialCustomers: Customer[];
  initialOrders: Order[];
  customFieldDefs?: CustomFieldDef[];
}) {
  const router = useRouter();
  const [customers, setCustomers] = useState(initialCustomers);
  const [orders] = useState(initialOrders);

  const rankedCustomers = useMemo(
    () => withLoyalty(customers, orders),
    [customers, orders],
  );

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

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <main className="min-h-screen p-8 max-w-4xl mx-auto space-y-10">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">rice-mice dashboard</h1>
        <nav className="flex gap-4 text-sm text-neutral-500">
          <Link href="/dashboard/orders" className="underline">
            Order pad
          </Link>
          <Link href="/dashboard/items" className="underline">
            Menu items
          </Link>
          <Link href="/dashboard/segments" className="underline">
            Segments
          </Link>
          <Link href="/dashboard/campaigns" className="underline">
            Campaigns
          </Link>
          <button onClick={handleSignOut} className="underline">
            Sign out
          </button>
        </nav>
      </div>

      <section>
        <h2 className="text-lg font-semibold mb-3">Sign-ups</h2>
        {rankedCustomers.length === 0 ? (
          <p className="text-neutral-500">
            No sign-ups yet. Share your QR code!
          </p>
        ) : (
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="text-left border-b">
                <th className="py-2">Name</th>
                <th className="py-2">Phone</th>
                <th className="py-2">WhatsApp</th>
                <th className="py-2">Signed up</th>
                <th className="py-2">Loyalty</th>
                <th className="py-2">Tags</th>
                {customFieldDefs.length > 0 && <th className="py-2">Custom fields</th>}
              </tr>
            </thead>
            <tbody>
              {rankedCustomers.map((c) => (
                <tr key={c.id} className="border-b">
                  <td className="py-2">
                    {c.first_name} {c.last_name}
                    {c.atRisk && (
                      <span className="ml-2 text-xs bg-red-100 text-red-700 rounded px-1.5 py-0.5">
                        At Risk
                      </span>
                    )}
                  </td>
                  <td className="py-2">{c.phone ?? "-"}</td>
                  <td className="py-2">{c.whatsapp_opt_in ? "Yes" : "No"}</td>
                  <td className="py-2">
                    {new Date(c.created_at).toLocaleDateString()}
                  </td>
                  <td className="py-2">{c.loyaltyScore}</td>
                  <td className="py-2">
                    <TagCell
                      tags={c.tags ?? []}
                      onChange={(t) => updateTags(c.id, t)}
                    />
                  </td>
                  {customFieldDefs.length > 0 && (
                    <td className="py-2">
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
        )}
      </section>

      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold">Orders</h2>
          <Link
            href="/dashboard/orders"
            className="text-sm bg-black text-white rounded px-4 py-2"
          >
            New order
          </Link>
        </div>
        {orders.length === 0 ? (
          <p className="text-neutral-500">
            No orders yet.{" "}
            <Link href="/dashboard/orders" className="underline">
              Take your first order.
            </Link>
          </p>
        ) : (
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="text-left border-b">
                <th className="py-2">Order</th>
                <th className="py-2">Customer</th>
                <th className="py-2">Items</th>
                <th className="py-2">Status</th>
                <th className="py-2">Amount</th>
                <th className="py-2">Date</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id} className="border-b">
                  <td className="py-2 font-medium">
                    <Link
                      href={`/dashboard/orders/${o.id}`}
                      className="hover:underline"
                    >
                      #{o.order_no}
                    </Link>
                  </td>
                  <td className="py-2">
                    {customerName(customers, o.customer_id)}
                  </td>
                  <td className="py-2 max-w-xs truncate">
                    {orderSummary(o) || "-"}
                  </td>
                  <td className="py-2">
                    <span
                      className={`text-xs rounded-full px-2 py-0.5 capitalize ${
                        STATUS_STYLES[o.status] ?? STATUS_STYLES.open
                      }`}
                    >
                      {o.status}
                    </span>
                  </td>
                  <td className="py-2">{formatCents(o.total_cents)}</td>
                  <td className="py-2">
                    {new Date(o.created_at).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}

function TagCell({
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
          className="text-xs bg-neutral-100 rounded px-1.5 py-0.5 flex items-center gap-1"
        >
          {t}
          <button
            onClick={() => onChange(tags.filter((x) => x !== t))}
            className="text-neutral-400 hover:text-red-600"
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
          className="w-20 border border-neutral-300 rounded px-1 text-xs"
        />
      ) : (
        <button
          onClick={() => setAdding(true)}
          className="text-xs text-neutral-400 hover:text-neutral-700"
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

function CustomFieldsCell({
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
            className="text-violet-400 hover:text-red-600"
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
              className="text-xs border border-neutral-300 rounded px-1.5 py-0.5"
            >
              Yes
            </button>
            <button
              onClick={() => commit(addingDef.key, false)}
              className="text-xs border border-neutral-300 rounded px-1.5 py-0.5"
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
            className="w-24 border border-neutral-300 rounded px-1 text-xs"
          />
        )
      ) : unset.length > 0 ? (
        <select
          value=""
          onChange={(e) => {
            if (e.target.value) setAdding(e.target.value);
          }}
          className="text-xs border border-neutral-300 rounded bg-white text-neutral-400"
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
