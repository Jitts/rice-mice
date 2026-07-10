"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

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

export type Transaction = {
  id: string;
  customer_id: string;
  item_description: string | null;
  amount_cents: number | null;
  payment_method: string | null;
  staff_name: string | null;
  created_at: string;
};

function formatCents(cents: number | null) {
  if (cents == null) return "-";
  return `R${(cents / 100).toFixed(2)}`;
}

function customerName(customers: Customer[], customerId: string) {
  const c = customers.find((c) => c.id === customerId);
  return c ? `${c.first_name} ${c.last_name}` : "Unknown";
}

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

function withLoyalty(customers: Customer[], transactions: Transaction[]) {
  const statsByCustomer = new Map<string, { count: number; totalCents: number }>();
  for (const t of transactions) {
    const stats = statsByCustomer.get(t.customer_id) ?? {
      count: 0,
      totalCents: 0,
    };
    stats.count += 1;
    stats.totalCents += t.amount_cents ?? 0;
    statsByCustomer.set(t.customer_id, stats);
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

function AddTransactionForm({
  customers,
  onAdded,
}: {
  customers: Customer[];
  onAdded: (t: Transaction) => void;
}) {
  const [customerId, setCustomerId] = useState("");
  const [item, setItem] = useState("");
  const [amount, setAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("card");
  const [staffName, setStaffName] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!customerId || !amount) return;

    setStatus("loading");
    const supabase = createClient();

    const { data, error } = await supabase
      .from("transactions")
      .insert({
        customer_id: customerId,
        item_description: item || null,
        amount_cents: Math.round(parseFloat(amount) * 100),
        payment_method: paymentMethod,
        staff_name: staffName || null,
      })
      .select()
      .single();

    if (error || !data) {
      setStatus("error");
      return;
    }

    await supabase
      .from("customers")
      .update({ last_purchase_date: data.created_at })
      .eq("id", customerId);

    setStatus("idle");
    setItem("");
    setAmount("");
    setStaffName("");
    onAdded(data as Transaction);
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-wrap gap-2 items-end border rounded p-4 mb-6"
    >
      <div className="flex flex-col">
        <label className="text-xs text-neutral-500">Customer</label>
        <select
          required
          value={customerId}
          onChange={(e) => setCustomerId(e.target.value)}
          className="border rounded px-2 py-1.5"
        >
          <option value="">Select customer</option>
          {customers.map((c) => (
            <option key={c.id} value={c.id}>
              {c.first_name} {c.last_name}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col">
        <label className="text-xs text-neutral-500">Item</label>
        <input
          value={item}
          onChange={(e) => setItem(e.target.value)}
          placeholder="Rice Bowl (Large)"
          className="border rounded px-2 py-1.5"
        />
      </div>
      <div className="flex flex-col">
        <label className="text-xs text-neutral-500">Amount (R)</label>
        <input
          required
          type="number"
          step="0.01"
          min="0"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="85.00"
          className="border rounded px-2 py-1.5 w-24"
        />
      </div>
      <div className="flex flex-col">
        <label className="text-xs text-neutral-500">Payment</label>
        <select
          value={paymentMethod}
          onChange={(e) => setPaymentMethod(e.target.value)}
          className="border rounded px-2 py-1.5"
        >
          <option value="card">Card</option>
          <option value="cash">Cash</option>
          <option value="other">Other</option>
        </select>
      </div>
      <div className="flex flex-col">
        <label className="text-xs text-neutral-500">Staff</label>
        <input
          value={staffName}
          onChange={(e) => setStaffName(e.target.value)}
          placeholder="Your name"
          className="border rounded px-2 py-1.5"
        />
      </div>
      <button
        type="submit"
        disabled={status === "loading"}
        className="bg-black text-white rounded px-4 py-1.5 disabled:opacity-50"
      >
        {status === "loading" ? "Adding…" : "Add Transaction"}
      </button>
      {status === "error" && (
        <p className="text-red-600 text-sm w-full">
          Something went wrong — please try again.
        </p>
      )}
    </form>
  );
}

export function DashboardClient({
  initialCustomers,
  initialTransactions,
}: {
  initialCustomers: Customer[];
  initialTransactions: Transaction[];
}) {
  const router = useRouter();
  const [customers, setCustomers] = useState(initialCustomers);
  const [transactions, setTransactions] = useState(initialTransactions);

  const rankedCustomers = useMemo(
    () => withLoyalty(customers, transactions),
    [customers, transactions],
  );

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  function handleAdded(t: Transaction) {
    setTransactions((prev) => [t, ...prev]);
    setCustomers((prev) =>
      prev.map((c) =>
        c.id === t.customer_id ? { ...c, last_purchase_date: t.created_at } : c,
      ),
    );
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
        <h2 className="text-lg font-semibold mb-3">Transactions</h2>
        <AddTransactionForm customers={customers} onAdded={handleAdded} />
        {transactions.length === 0 ? (
          <p className="text-neutral-500">No transactions logged yet.</p>
        ) : (
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="text-left border-b">
                <th className="py-2">Customer</th>
                <th className="py-2">Item</th>
                <th className="py-2">Amount</th>
                <th className="py-2">Staff</th>
                <th className="py-2">Date</th>
              </tr>
            </thead>
            <tbody>
              {transactions.map((t) => (
                <tr key={t.id} className="border-b">
                  <td className="py-2">{customerName(customers, t.customer_id)}</td>
                  <td className="py-2">{t.item_description ?? "-"}</td>
                  <td className="py-2">{formatCents(t.amount_cents)}</td>
                  <td className="py-2">{t.staff_name ?? "-"}</td>
                  <td className="py-2">
                    {new Date(t.created_at).toLocaleDateString()}
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
