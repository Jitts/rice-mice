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
}: {
  initialCustomers: Customer[];
  initialOrders: Order[];
}) {
  const router = useRouter();
  const [customers] = useState(initialCustomers);
  const [orders] = useState(initialOrders);

  const rankedCustomers = useMemo(
    () => withLoyalty(customers, orders),
    [customers, orders],
  );

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
                  <td className="py-2 font-medium">#{o.order_no}</td>
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
