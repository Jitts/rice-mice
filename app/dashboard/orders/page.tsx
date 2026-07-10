import { createClient } from "@/lib/supabase/server";
import { OrderPad } from "@/components/OrderPad";

export const dynamic = "force-dynamic";

export default async function OrdersPage() {
  const supabase = await createClient();

  const [{ data: items }, { data: customers }, { data: orders }] =
    await Promise.all([
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
        .order("created_at", { ascending: false })
        .limit(12),
    ]);

  return (
    <OrderPad
      initialItems={items ?? []}
      customers={customers ?? []}
      initialOrders={orders ?? []}
    />
  );
}
