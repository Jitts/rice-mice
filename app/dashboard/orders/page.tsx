import { createClient } from "@/lib/supabase/server";
import { readAll } from "@/lib/supabase/readAll";
import { OrderPad, type CustomerOption } from "@/components/OrderPad";
import {
  basePoints,
  pointsByCustomer,
  withLoyaltyDefaults,
  type LoyaltyOrderRow,
  type Reward,
} from "@/lib/loyalty";

export const dynamic = "force-dynamic";

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ customer?: string }>;
}) {
  const { customer: preselectId } = await searchParams;
  const supabase = await createClient();

  const [
    { data: items },
    customersRead,
    { data: active },
    { data: history },
    { data: rewards },
    pointsRead,
    { data: businessRow },
  ] = await Promise.all([
    supabase
      .from("items")
      .select("*")
      .eq("is_active", true)
      .order("sort_order")
      .order("created_at"),
    readAll<CustomerOption>(
      "of your customers",
      (from, to) =>
        supabase
          .from("customers")
          .select("id, first_name, last_name", { count: "exact" })
          .order("first_name")
          .order("id")
          .range(from, to),
    ),
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
    supabase
      .from("rewards")
      .select("id, name, description, points_cost, benefit_type, benefit_value, active")
      .eq("active", true)
      .order("points_cost"),
    // Minimal projection over ALL orders to derive each customer's points.
    // Lifetime by definition — points are earned and spent across a customer's
    // whole history — so this cannot be windowed, only made complete.
    readAll<{
      customer_id: string | null;
      status: string;
      total_cents: number;
      reward_points_spent: number | null;
    }>("of your orders", (from, to) =>
      supabase
        .from("orders")
        .select("customer_id, status, total_cents, reward_points_spent", { count: "exact" })
        .order("id")
        .range(from, to),
    ),
    supabase.from("businesses").select("*").maybeSingle(),
  ]);

  // The points roll-up and the customer picker both need every row: a short
  // read would understate loyalty balances and hide people from the picker.
  if (!customersRead.ok) throw new Error(customersRead.error);
  if (!pointsRead.ok) throw new Error(pointsRead.error);

  // Prefill an entry for every customer (not just those with orders), so a
  // welcome bonus reaches customers who haven't ordered yet.
  const loyalty = withLoyaltyDefaults(businessRow);
  const points = pointsByCustomer(
    pointsRead.rows as LoyaltyOrderRow[],
    loyalty,
  );
  for (const c of customersRead.rows) {
    if (!points[c.id]) points[c.id] = basePoints(loyalty);
  }

  // Deep link from the Customer 360 page ("Start an order") — only honour ids
  // that actually exist.
  const initialCustomerId = customersRead.rows.some((c) => c.id === preselectId)
    ? preselectId
    : undefined;

  return (
    <OrderPad
      initialItems={items ?? []}
      customers={customersRead.rows}
      initialOrders={[...(active ?? []), ...(history ?? [])]}
      rewards={(rewards ?? []) as Reward[]}
      pointsByCustomer={points}
      initialCustomerId={initialCustomerId}
    />
  );
}
