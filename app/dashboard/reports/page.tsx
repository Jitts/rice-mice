import { createClient } from "@/lib/supabase/server";
import { ReportsManager } from "@/components/ReportsManager";
import type { Order } from "@/lib/orders";

export const dynamic = "force-dynamic";

export default async function ReportsPage() {
  const supabase = await createClient();

  const { data: orders } = await supabase
    .from("orders")
    .select("*, order_items(*)")
    .order("created_at", { ascending: false });

  return <ReportsManager initialOrders={(orders ?? []) as Order[]} />;
}
