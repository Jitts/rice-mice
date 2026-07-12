"use client";

import Link from "next/link";
import { formatCents } from "@/lib/format";
import { brandLine, type BusinessSettings } from "@/lib/business";
import type { Order } from "@/lib/orders";

export type ReceiptOrder = Order & {
  customers: { first_name: string; last_name: string } | null;
  campaigns: { offer_code: string | null } | null;
};

// A thermal-printer-shaped (~80mm) receipt. The print CSS below hides the
// dashboard shell so the browser's Print (or a receipt printer driver) gets
// just the slip — no sidebar, no toolbar.
export function Receipt({
  order,
  business,
}: {
  order: ReceiptOrder;
  business: BusinessSettings;
}) {
  const lines = order.order_items ?? [];
  const subtotalCents = lines.reduce(
    (s, l) => s + l.unit_price_cents * l.quantity,
    0,
  );
  const discount = order.discount_cents ?? 0;
  const placed = new Date(order.created_at);
  const provisional = order.status !== "completed" && order.status !== "cancelled";

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      {/* Print rules, scoped to this page: strip the shell + its padding. */}
      <style>{`
        @media print {
          header, aside { display: none !important; }
          main { padding: 0 !important; margin: 0 !important; }
          main > div { padding: 0 !important; }
          @page { margin: 6mm; }
        }
      `}</style>

      <div className="flex items-center justify-between print:hidden">
        <Link
          href={`/dashboard/orders/${order.id}`}
          className="text-sm text-neutral-500 hover:text-neutral-900"
        >
          ← Order #{order.order_no}
        </Link>
        <button
          onClick={() => window.print()}
          className="text-sm bg-neutral-900 text-white rounded-lg px-4 py-2 hover:bg-neutral-700"
        >
          Print
        </button>
      </div>

      <div className="mx-auto w-[302px] bg-white border border-neutral-200 rounded-lg print:border-0 print:rounded-none px-4 py-5 font-mono text-[13px] leading-5 text-neutral-900">
        <div className="text-center space-y-0.5">
          <p className="text-base font-bold">{brandLine(business)}</p>
          <p className="text-neutral-500">{business.tagline}</p>
          {business.address && <p className="text-neutral-500">{business.address}</p>}
          {business.phone && <p className="text-neutral-500">{business.phone}</p>}
        </div>

        <div className="border-t border-dashed border-neutral-300 my-3" />

        <div className="flex justify-between">
          <span>Receipt #{order.order_no}</span>
          <span>{placed.toLocaleDateString()}</span>
        </div>
        <div className="flex justify-between text-neutral-500">
          <span>{order.staff_name ? `Served by ${order.staff_name}` : " "}</span>
          <span>
            {placed.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </span>
        </div>
        {order.customers && (
          <p className="text-neutral-500">
            Customer: {order.customers.first_name} {order.customers.last_name}
          </p>
        )}

        {order.status === "cancelled" && (
          <p className="mt-2 text-center font-bold uppercase tracking-widest">
            *** Cancelled ***
          </p>
        )}
        {provisional && (
          <p className="mt-2 text-center text-neutral-500 uppercase tracking-widest">
            — provisional ({order.status}) —
          </p>
        )}

        <div className="border-t border-dashed border-neutral-300 my-3" />

        {lines.length === 0 ? (
          <p className="text-neutral-500">No items.</p>
        ) : (
          <div className="space-y-1">
            {lines.map((l) => (
              <div key={l.id} className="flex justify-between gap-2">
                <span className="min-w-0">
                  {l.quantity}× {l.item_name}
                </span>
                <span className="shrink-0">
                  {formatCents(l.unit_price_cents * l.quantity)}
                </span>
              </div>
            ))}
          </div>
        )}

        <div className="border-t border-dashed border-neutral-300 my-3" />

        {discount > 0 && (
          <>
            <div className="flex justify-between">
              <span>Subtotal</span>
              <span>{formatCents(subtotalCents)}</span>
            </div>
            <div className="flex justify-between">
              <span>
                Discount
                {order.campaigns?.offer_code ? ` (${order.campaigns.offer_code})` : ""}
              </span>
              <span>-{formatCents(discount)}</span>
            </div>
          </>
        )}
        <div className="flex justify-between text-base font-bold mt-1">
          <span>TOTAL</span>
          <span>{formatCents(order.total_cents)}</span>
        </div>
        {order.payment_method && (
          <p className="text-neutral-500 capitalize">Paid by {order.payment_method}</p>
        )}

        <div className="border-t border-dashed border-neutral-300 my-3" />

        <p className="text-center text-neutral-500">{business.receipt_footer}</p>
      </div>
    </div>
  );
}
