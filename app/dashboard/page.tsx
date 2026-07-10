import { createClient } from "@/lib/supabase/server";
import { DashboardClient } from "@/components/DashboardClient";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const supabase = await createClient();

  const [{ data: customers }, { data: orders }, { data: customFields }] = await Promise.all([
    supabase
      .from("customers")
      .select("*")
      .order("created_at", { ascending: false }),
    supabase
      .from("orders")
      .select("*, order_items(*)")
      .order("created_at", { ascending: false }),
    supabase.from("custom_fields").select("key, label, value_type").order("sort_order"),
  ]);

  return (
    <DashboardClient
      initialCustomers={customers ?? []}
      initialOrders={orders ?? []}
      customFieldDefs={customFields ?? []}
    />
  );
}
