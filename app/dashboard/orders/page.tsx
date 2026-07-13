import { createClient } from "@/lib/supabase/server";
import { OrderPad } from "@/components/OrderPad";
import {
  basePoints,
  pointsByCustomer,
  withLoyaltyDefaults,
  type LoyaltyOrderRow,
  type Reward,
} from "@/lib/loyalty";

export const dynamic = "force-dynamic";

export default async function OrdersPage() {
  const supabase = await createClient();

  const [
    { data: items },
    { data: customers },
    { data: active },
    { data: history },
    { data: rewards },
    { data: pointsRows },
    { data: businessRow },
  ] = await Promise.all([
    supabase
      .from("items")
      .select("*")
      .eq("is_active", true)
      .order("sort_order")
      .order("created_at"),
    supabase
      .from("customers")
      .select("id, first_name, last_name")
      .order("first_name"),
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
    supabase
      .from("orders")
      .select("customer_id, status, total_cents, reward_points_spent"),
    supabase.from("business_settings").select("*").maybeSingle(),
  ]);

  // Prefill an entry for every customer (not just those with orders), so a
  // welcome bonus reaches customers who haven't ordered yet.
  const loyalty = withLoyaltyDefaults(businessRow);
  const points = pointsByCustomer(
    (pointsRows ?? []) as LoyaltyOrderRow[],
    loyalty,
  );
  for (const c of customers ?? []) {
    if (!points[c.id]) points[c.id] = basePoints(loyalty);
  }

  return (
    <OrderPad
      initialItems={items ?? []}
      customers={customers ?? []}
      initialOrders={[...(active ?? []), ...(history ?? [])]}
      rewards={(rewards ?? []) as Reward[]}
      pointsByCustomer={points}
    />
  );
}
