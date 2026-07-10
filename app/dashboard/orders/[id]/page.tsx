import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { OrderDetail } from "@/components/OrderDetail";

export const dynamic = "force-dynamic";

export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: order } = await supabase
    .from("orders")
    .select("*, order_items(*)")
    .eq("id", id)
    .single();

  if (!order) notFound();

  const [{ data: customer }, { data: activeItems }] = await Promise.all([
    order.customer_id
      ? supabase
          .from("customers")
          .select("id, first_name, last_name")
          .eq("id", order.customer_id)
          .single()
      : Promise.resolve({ data: null }),
    supabase
      .from("items")
      .select("*")
      .eq("is_active", true)
      .order("sort_order")
      .order("created_at"),
  ]);

  return (
    <OrderDetail
      order={order}
      customer={customer ?? null}
      activeItems={activeItems ?? []}
    />
  );
}
