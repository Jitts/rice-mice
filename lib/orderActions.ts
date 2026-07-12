import type { SupabaseClient } from "@supabase/supabase-js";
import type { Order, OrderLine, OrderStatus } from "@/lib/orders";
import type { Item } from "@/components/ItemsManager";

const ORDER_SELECT = "*, order_items(*)";

export function lineTotalCents(lines: OrderLine[]): number {
  return lines.reduce((sum, l) => sum + l.unit_price_cents * l.quantity, 0);
}

// Change an order's status. Completing a sale with a customer stamps their
// last purchase (drives the At Risk flag), so this side effect lives in one
// place shared by the queue card and the order-detail screen.
export async function setOrderStatus(
  supabase: SupabaseClient,
  order: Order,
  status: OrderStatus,
): Promise<Order | null> {
  const { data, error } = await supabase
    .from("orders")
    .update({ status })
    .eq("id", order.id)
    .select(ORDER_SELECT)
    .single();

  if (error || !data) return null;

  if (status === "completed" && order.customer_id) {
    await supabase
      .from("customers")
      .update({ last_purchase_date: new Date().toISOString() })
      .eq("id", order.customer_id);
  }

  return data as Order;
}

// The charged total is the line total minus any redeemed discount (floored at
// zero). The discount amount was fixed at redemption — editing lines afterwards
// never re-derives it, consistent with the price-snapshot rule.
async function persistTotal(
  supabase: SupabaseClient,
  orderId: string,
  lines: OrderLine[],
  discountCents: number,
): Promise<number> {
  const total = Math.max(0, lineTotalCents(lines) - discountCents);
  await supabase.from("orders").update({ total_cents: total }).eq("id", orderId);
  return total;
}

// Add an item as a new line (snapshotting its current name/price) and keep the
// order total in sync. Returns the new line plus the recomputed total.
export async function addOrderLine(
  supabase: SupabaseClient,
  order: Order,
  existingLines: OrderLine[],
  item: Item,
): Promise<{ line: OrderLine; totalCents: number } | null> {
  const { data, error } = await supabase
    .from("order_items")
    .insert({
      order_id: order.id,
      item_id: item.id,
      item_name: item.name,
      unit_price_cents: item.price_cents,
      quantity: 1,
    })
    .select()
    .single();

  if (error || !data) return null;

  const line = data as OrderLine;
  const totalCents = await persistTotal(
    supabase,
    order.id,
    [...existingLines, line],
    order.discount_cents ?? 0,
  );
  return { line, totalCents };
}

export async function setLineQuantity(
  supabase: SupabaseClient,
  order: Order,
  lines: OrderLine[],
  lineId: string,
  quantity: number,
): Promise<{ lines: OrderLine[]; totalCents: number } | null> {
  const { error } = await supabase
    .from("order_items")
    .update({ quantity })
    .eq("id", lineId);

  if (error) return null;

  const nextLines = lines.map((l) =>
    l.id === lineId ? { ...l, quantity } : l,
  );
  const totalCents = await persistTotal(
    supabase,
    order.id,
    nextLines,
    order.discount_cents ?? 0,
  );
  return { lines: nextLines, totalCents };
}

export async function removeOrderLine(
  supabase: SupabaseClient,
  order: Order,
  lines: OrderLine[],
  lineId: string,
): Promise<{ lines: OrderLine[]; totalCents: number } | null> {
  const { error } = await supabase
    .from("order_items")
    .delete()
    .eq("id", lineId);

  if (error) return null;

  const nextLines = lines.filter((l) => l.id !== lineId);
  const totalCents = await persistTotal(
    supabase,
    order.id,
    nextLines,
    order.discount_cents ?? 0,
  );
  return { lines: nextLines, totalCents };
}
