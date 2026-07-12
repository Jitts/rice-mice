"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { formatCents } from "@/lib/format";
import {
  advanceLabel,
  isActiveStatus,
  nextStatus,
  STATUS_STYLES,
  type Order,
  type OrderLine,
  type OrderStatus,
} from "@/lib/orders";
import {
  addOrderLine,
  removeOrderLine,
  setLineQuantity,
  setOrderStatus,
} from "@/lib/orderActions";
import type { Item } from "@/components/ItemsManager";

export type OrderCustomer = {
  id: string;
  first_name: string;
  last_name: string;
} | null;

export function OrderDetail({
  order: initialOrder,
  customer,
  activeItems,
}: {
  order: Order;
  customer: OrderCustomer;
  activeItems: Item[];
}) {
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null);
  if (!supabaseRef.current) supabaseRef.current = createClient();
  const supabase = supabaseRef.current;

  const [status, setStatus] = useState<OrderStatus>(initialOrder.status);
  const [lines, setLines] = useState<OrderLine[]>(
    initialOrder.order_items ?? [],
  );
  const [totalCents, setTotalCents] = useState(initialOrder.total_cents);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const editable = isActiveStatus(status);
  const next = nextStatus(status);
  const label = advanceLabel(status);

  const orderShell: Order = useMemo(
    () => ({ ...initialOrder, status, total_cents: totalCents, order_items: lines }),
    [initialOrder, status, totalCents, lines],
  );

  async function changeStatus(to: OrderStatus) {
    setBusy(true);
    setError(null);
    const updated = await setOrderStatus(supabase, orderShell, to);
    setBusy(false);
    if (!updated) {
      setError("Couldn't update the status. Try again.");
      return;
    }
    setStatus(updated.status);
    setTotalCents(updated.total_cents);
  }

  async function addItem(item: Item) {
    setBusy(true);
    setError(null);
    const result = await addOrderLine(supabase, initialOrder, lines, item);
    setBusy(false);
    if (!result) {
      setError("Couldn't add the item. Try again.");
      return;
    }
    setLines((prev) => [...prev, result.line]);
    setTotalCents(result.totalCents);
  }

  async function changeQty(line: OrderLine, delta: number) {
    const nextQty = line.quantity + delta;
    setBusy(true);
    setError(null);

    if (nextQty <= 0) {
      if (lines.length === 1) {
        setBusy(false);
        setError("An order needs at least one item. Cancel it instead.");
        return;
      }
      const result = await removeOrderLine(
        supabase,
        initialOrder,
        lines,
        line.id,
      );
      setBusy(false);
      if (!result) {
        setError("Couldn't update the item. Try again.");
        return;
      }
      setLines(result.lines);
      setTotalCents(result.totalCents);
      return;
    }

    const result = await setLineQuantity(
      supabase,
      initialOrder,
      lines,
      line.id,
      nextQty,
    );
    setBusy(false);
    if (!result) {
      setError("Couldn't update the item. Try again.");
      return;
    }
    setLines(result.lines);
    setTotalCents(result.totalCents);
  }

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      <Link
        href="/dashboard/orders"
        className="inline-block text-sm text-neutral-500 hover:text-neutral-900"
      >
        ← Order pad
      </Link>

      <div>
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold">Order #{initialOrder.order_no}</h1>
          <span
            className={`text-xs rounded-full px-2.5 py-1 capitalize ${
              STATUS_STYLES[status] ?? STATUS_STYLES.open
            }`}
          >
            {status}
          </span>
          <Link
            href={`/dashboard/orders/${initialOrder.id}/receipt`}
            className="ml-auto text-sm border border-neutral-300 rounded-lg px-3 py-1.5 text-neutral-600 hover:border-neutral-500"
          >
            Print receipt
          </Link>
        </div>
        <dl className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
          <div>
            <dt className="text-neutral-500">Customer</dt>
            <dd>{customer ? `${customer.first_name} ${customer.last_name}` : "Walk-in"}</dd>
          </div>
          <div>
            <dt className="text-neutral-500">Payment</dt>
            <dd className="capitalize">{initialOrder.payment_method ?? "-"}</dd>
          </div>
          <div>
            <dt className="text-neutral-500">Staff</dt>
            <dd>{initialOrder.staff_name ?? "-"}</dd>
          </div>
          <div>
            <dt className="text-neutral-500">Placed</dt>
            <dd>{new Date(initialOrder.created_at).toLocaleString()}</dd>
          </div>
        </dl>
      </div>

      <section>
        <h2 className="text-lg font-semibold mb-3">Items</h2>
        <ul className="divide-y border-y">
          {lines.length === 0 ? (
            <li className="py-3 text-neutral-500">No items on this order.</li>
          ) : (
            lines.map((line) => (
              <li
                key={line.id}
                className="py-3 flex items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <p className="font-medium truncate">{line.item_name}</p>
                  <p className="text-xs text-neutral-500">
                    {formatCents(line.unit_price_cents)} each
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  {editable ? (
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => changeQty(line, -1)}
                        disabled={busy}
                        aria-label={`Remove one ${line.item_name}`}
                        className="w-11 h-11 border rounded text-lg disabled:opacity-50"
                      >
                        −
                      </button>
                      <span className="w-8 text-center font-medium">
                        {line.quantity}
                      </span>
                      <button
                        onClick={() => changeQty(line, 1)}
                        disabled={busy}
                        aria-label={`Add one ${line.item_name}`}
                        className="w-11 h-11 border rounded text-lg disabled:opacity-50"
                      >
                        +
                      </button>
                    </div>
                  ) : (
                    <span className="text-sm text-neutral-500">
                      ×{line.quantity}
                    </span>
                  )}
                  <span className="w-20 text-right font-medium">
                    {formatCents(line.unit_price_cents * line.quantity)}
                  </span>
                </div>
              </li>
            ))
          )}
        </ul>
        {initialOrder.discount_cents > 0 && (
          <div className="flex justify-between items-baseline pt-3 text-sm text-emerald-700">
            <span>Offer discount</span>
            <span>−{formatCents(initialOrder.discount_cents)}</span>
          </div>
        )}
        <div className="flex justify-between items-baseline pt-3">
          <span className="font-semibold">Total</span>
          <span className="text-xl font-bold">{formatCents(totalCents)}</span>
        </div>
      </section>

      {editable && (
        <section>
          <h2 className="text-lg font-semibold mb-3">Add an item</h2>
          {activeItems.length === 0 ? (
            <p className="text-neutral-500 text-sm">No active menu items.</p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {activeItems.map((item) => (
                <button
                  key={item.id}
                  onClick={() => addItem(item)}
                  disabled={busy}
                  className="border rounded-lg p-4 text-center hover:border-black active:scale-[0.98] transition min-h-[76px] disabled:opacity-50"
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
      )}

      <section>
        <h2 className="text-lg font-semibold mb-3">Status</h2>
        {isActiveStatus(status) ? (
          <div className="flex gap-2">
            {next && label && (
              <button
                onClick={() => changeStatus(next)}
                disabled={busy}
                className="bg-black text-white rounded px-6 py-3 font-medium disabled:opacity-50"
              >
                {busy ? "…" : label}
              </button>
            )}
            <button
              onClick={() => changeStatus("cancelled")}
              disabled={busy}
              className="rounded px-6 py-3 border border-neutral-300 text-neutral-500 disabled:opacity-50"
            >
              Cancel order
            </button>
          </div>
        ) : (
          <p className="text-neutral-500 text-sm">
            This order is {status} and can no longer be edited.
          </p>
        )}
        {error && <p className="text-red-600 text-sm mt-3">{error}</p>}
      </section>
    </div>
  );
}
