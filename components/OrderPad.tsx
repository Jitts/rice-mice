"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { formatCents } from "@/lib/format";
import {
  advanceLabel,
  isActiveStatus,
  nextStatus,
  orderSummary,
  STATUS_STYLES,
  type Order,
  type OrderStatus,
} from "@/lib/orders";
import { setOrderStatus } from "@/lib/orderActions";
import type { Item } from "@/components/ItemsManager";

// How often to pull fresh order state so a second device (kitchen tablet,
// counter iPad) converges on new/advanced orders without a manual reload.
const POLL_INTERVAL_MS = 12000;

async function fetchOrders(
  supabase: ReturnType<typeof createClient>,
): Promise<Order[]> {
  const [{ data: active }, { data: history }] = await Promise.all([
    supabase
      .from("orders")
      .select("*, order_items(*)")
      .in("status", ["open", "preparing", "ready"])
      .order("created_at", { ascending: true }),
    supabase
      .from("orders")
      .select("*, order_items(*)")
      .in("status", ["completed", "cancelled"])
      .order("created_at", { ascending: false })
      .limit(12),
  ]);
  return [...((active as Order[]) ?? []), ...((history as Order[]) ?? [])];
}

export type CustomerOption = {
  id: string;
  first_name: string;
  last_name: string;
};

type CartLine = { item: Item; quantity: number };

const PAYMENT_METHODS = ["card", "cash", "other"] as const;

function OrderCard({
  order,
  onChanged,
}: {
  order: Order;
  onChanged: (order: Order) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const next = nextStatus(order.status);
  const label = advanceLabel(order.status);

  async function setStatus(status: OrderStatus) {
    setBusy(true);
    setError(false);
    const updated = await setOrderStatus(createClient(), order, status);
    setBusy(false);
    if (!updated) {
      setError(true);
      return;
    }
    onChanged(updated);
  }

  return (
    <div className="border rounded-lg p-4">
      <div className="flex items-center justify-between mb-2">
        <Link
          href={`/dashboard/orders/${order.id}`}
          className="font-semibold hover:underline"
        >
          #{order.order_no}
        </Link>
        <span
          className={`text-xs rounded-full px-2.5 py-1 capitalize ${
            STATUS_STYLES[order.status] ?? STATUS_STYLES.open
          }`}
        >
          {order.status}
        </span>
      </div>
      <p className="text-sm text-neutral-600 mb-2 line-clamp-2">
        {orderSummary(order) || "—"}
      </p>
      <div className="flex justify-between text-sm mb-3">
        <span className="text-neutral-500">
          {new Date(order.created_at).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </span>
        <span className="font-medium">{formatCents(order.total_cents)}</span>
      </div>

      {isActiveStatus(order.status) ? (
        <div className="flex gap-2">
          {next && label && (
            <button
              onClick={() => setStatus(next)}
              disabled={busy}
              className="flex-1 bg-black text-white rounded py-2.5 text-sm font-medium disabled:opacity-50"
            >
              {busy ? "…" : label}
            </button>
          )}
          <Link
            href={`/dashboard/orders/${order.id}`}
            className="rounded py-2.5 px-3 text-sm border border-neutral-300 text-neutral-500 flex items-center"
          >
            Edit
          </Link>
        </div>
      ) : (
        <Link
          href={`/dashboard/orders/${order.id}`}
          className="text-sm text-neutral-500 underline"
        >
          View details
        </Link>
      )}
      {error && (
        <p className="text-red-600 text-xs mt-2">Couldn&apos;t update — try again.</p>
      )}
    </div>
  );
}

export function OrderPad({
  initialItems,
  customers,
  initialOrders,
}: {
  initialItems: Item[];
  customers: CustomerOption[];
  initialOrders: Order[];
}) {
  const [cart, setCart] = useState<CartLine[]>([]);
  const [customerId, setCustomerId] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<string>("card");
  const [staffName, setStaffName] = useState("");
  const [orders, setOrders] = useState(initialOrders);
  const [status, setStatus] = useState<"idle" | "placing" | "error">("idle");
  const [placedOrderNo, setPlacedOrderNo] = useState<number | null>(null);
  const [syncing, setSyncing] = useState(false);

  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null);
  if (!supabaseRef.current) supabaseRef.current = createClient();

  const refresh = useCallback(async () => {
    setSyncing(true);
    try {
      const fresh = await fetchOrders(supabaseRef.current!);
      setOrders(fresh);
    } finally {
      setSyncing(false);
    }
  }, []);

  // Keep the queue in sync across devices: poll on an interval, and refresh
  // immediately whenever the tab regains focus (staff switching back to it).
  useEffect(() => {
    const timer = setInterval(refresh, POLL_INTERVAL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  const activeOrders = useMemo(
    () =>
      orders
        .filter((o) => isActiveStatus(o.status))
        .sort(
          (a, b) =>
            new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
        ),
    [orders],
  );
  const historyOrders = useMemo(
    () =>
      orders
        .filter((o) => !isActiveStatus(o.status))
        .sort(
          (a, b) =>
            new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
        )
        .slice(0, 12),
    [orders],
  );

  const categories = useMemo(() => {
    const seen: string[] = [];
    for (const item of initialItems) {
      const cat = item.category ?? "Other";
      if (!seen.includes(cat)) seen.push(cat);
    }
    return seen;
  }, [initialItems]);

  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const visibleItems = activeCategory
    ? initialItems.filter((i) => (i.category ?? "Other") === activeCategory)
    : initialItems;

  const totalCents = cart.reduce(
    (sum, l) => sum + l.item.price_cents * l.quantity,
    0,
  );

  function addToCart(item: Item) {
    setPlacedOrderNo(null);
    setCart((prev) => {
      const existing = prev.find((l) => l.item.id === item.id);
      if (existing) {
        return prev.map((l) =>
          l.item.id === item.id ? { ...l, quantity: l.quantity + 1 } : l,
        );
      }
      return [...prev, { item, quantity: 1 }];
    });
  }

  function handleOrderChanged(updated: Order) {
    setOrders((prev) => prev.map((o) => (o.id === updated.id ? updated : o)));
  }

  function changeQuantity(itemId: string, delta: number) {
    setCart((prev) =>
      prev
        .map((l) =>
          l.item.id === itemId ? { ...l, quantity: l.quantity + delta } : l,
        )
        .filter((l) => l.quantity > 0),
    );
  }

  async function placeOrder() {
    if (cart.length === 0) return;

    setStatus("placing");
    const supabase = createClient();

    const { data: order, error: orderError } = await supabase
      .from("orders")
      .insert({
        customer_id: customerId || null,
        payment_method: paymentMethod,
        staff_name: staffName || null,
        total_cents: totalCents,
      })
      .select()
      .single();

    if (orderError || !order) {
      setStatus("error");
      return;
    }

    const { data: lines, error: linesError } = await supabase
      .from("order_items")
      .insert(
        cart.map((l) => ({
          order_id: order.id,
          item_id: l.item.id,
          item_name: l.item.name,
          unit_price_cents: l.item.price_cents,
          quantity: l.quantity,
        })),
      )
      .select();

    if (linesError || !lines) {
      await supabase.from("orders").delete().eq("id", order.id);
      setStatus("error");
      return;
    }

    setOrders((prev) => [{ ...order, order_items: lines } as Order, ...prev]);
    setCart([]);
    setCustomerId("");
    setStatus("idle");
    setPlacedOrderNo(order.order_no);
  }

  return (
    <main className="min-h-screen p-4 sm:p-8 max-w-5xl mx-auto space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Order pad</h1>
        <nav className="flex gap-4 text-sm text-neutral-500">
          <Link href="/dashboard/items" className="underline">
            Menu items
          </Link>
          <Link href="/dashboard" className="underline">
            Dashboard
          </Link>
        </nav>
      </div>

      {placedOrderNo != null && (
        <div className="rounded border border-green-300 bg-green-50 text-green-800 px-4 py-3 text-lg font-semibold">
          Order #{placedOrderNo} placed
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[3fr_2fr] gap-6">
        <section>
          <div className="flex flex-wrap gap-2 mb-4">
            <button
              onClick={() => setActiveCategory(null)}
              className={`rounded-full px-4 py-2 text-sm border ${
                activeCategory === null
                  ? "bg-black text-white border-black"
                  : "border-neutral-300 text-neutral-600"
              }`}
            >
              All
            </button>
            {categories.map((cat) => (
              <button
                key={cat}
                onClick={() => setActiveCategory(cat)}
                className={`rounded-full px-4 py-2 text-sm border ${
                  activeCategory === cat
                    ? "bg-black text-white border-black"
                    : "border-neutral-300 text-neutral-600"
                }`}
              >
                {cat}
              </button>
            ))}
          </div>

          {visibleItems.length === 0 ? (
            <p className="text-neutral-500">
              No active menu items.{" "}
              <Link href="/dashboard/items" className="underline">
                Add some first.
              </Link>
            </p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {visibleItems.map((item) => (
                <button
                  key={item.id}
                  onClick={() => addToCart(item)}
                  className="border rounded-lg p-4 text-center hover:border-black active:scale-[0.98] transition min-h-[76px]"
                >
                  <span className="block font-medium">{item.name}</span>
                  <span className="block text-sm text-neutral-500 mt-1">
                    {formatCents(item.price_cents)}
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="border rounded-lg p-4 h-fit lg:sticky lg:top-4">
          <h2 className="font-semibold mb-3">Current order</h2>

          {cart.length === 0 ? (
            <p className="text-neutral-500 text-sm mb-4">
              Tap items to add them.
            </p>
          ) : (
            <ul className="divide-y mb-4">
              {cart.map((line) => (
                <li
                  key={line.item.id}
                  className="py-2 flex items-center justify-between gap-2"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">
                      {line.item.name}
                    </p>
                    <p className="text-xs text-neutral-500">
                      {formatCents(line.item.price_cents)} each
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => changeQuantity(line.item.id, -1)}
                      aria-label={`Remove one ${line.item.name}`}
                      className="w-11 h-11 border rounded text-lg"
                    >
                      −
                    </button>
                    <span className="w-8 text-center text-sm font-medium">
                      {line.quantity}
                    </span>
                    <button
                      onClick={() => changeQuantity(line.item.id, 1)}
                      aria-label={`Add one ${line.item.name}`}
                      className="w-11 h-11 border rounded text-lg"
                    >
                      +
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <div className="flex justify-between items-baseline border-t pt-3 mb-4">
            <span className="font-semibold">Total</span>
            <span className="text-xl font-bold">{formatCents(totalCents)}</span>
          </div>

          <div className="space-y-3">
            <div className="flex flex-col">
              <label className="text-xs text-neutral-500 mb-1">
                Customer (optional)
              </label>
              <select
                value={customerId}
                onChange={(e) => setCustomerId(e.target.value)}
                className="border rounded px-3 py-2.5"
              >
                <option value="">Walk-in</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.first_name} {c.last_name}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-col">
              <label className="text-xs text-neutral-500 mb-1">Payment</label>
              <div className="grid grid-cols-3 gap-2">
                {PAYMENT_METHODS.map((method) => (
                  <button
                    key={method}
                    type="button"
                    onClick={() => setPaymentMethod(method)}
                    className={`rounded border py-2.5 text-sm capitalize ${
                      paymentMethod === method
                        ? "bg-black text-white border-black"
                        : "border-neutral-300 text-neutral-600"
                    }`}
                  >
                    {method}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-col">
              <label className="text-xs text-neutral-500 mb-1">Staff</label>
              <input
                value={staffName}
                onChange={(e) => setStaffName(e.target.value)}
                placeholder="Your name"
                className="border rounded px-3 py-2.5"
              />
            </div>

            <button
              onClick={placeOrder}
              disabled={cart.length === 0 || status === "placing"}
              className="w-full bg-black text-white rounded py-3.5 font-semibold disabled:opacity-40"
            >
              {status === "placing" ? "Placing…" : "Place order"}
            </button>
            {status === "error" && (
              <p className="text-red-600 text-sm">
                Something went wrong — the order was not placed. Try again.
              </p>
            )}
          </div>
        </section>
      </div>

      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold">Active queue</h2>
          <button
            onClick={refresh}
            disabled={syncing}
            className="text-xs text-neutral-500 border rounded-full px-3 py-1 disabled:opacity-50"
          >
            {syncing ? "Syncing…" : "Refresh"}
          </button>
        </div>
        {activeOrders.length === 0 ? (
          <p className="text-neutral-500">
            No active orders. New orders appear here for the kitchen.
          </p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {activeOrders.map((order) => (
              <OrderCard
                key={order.id}
                order={order}
                onChanged={handleOrderChanged}
              />
            ))}
          </div>
        )}
      </section>

      {historyOrders.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold mb-3">Recent history</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {historyOrders.map((order) => (
              <OrderCard
                key={order.id}
                order={order}
                onChanged={handleOrderChanged}
              />
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
