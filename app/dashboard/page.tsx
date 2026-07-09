import { createClient } from "@/lib/supabase/server";
import { DashboardClient } from "@/components/DashboardClient";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const supabase = await createClient();

  const [{ data: customers }, { data: transactions }] = await Promise.all([
    supabase
      .from("customers")
      .select("*")
      .order("created_at", { ascending: false }),
    supabase
      .from("transactions")
      .select("*")
      .order("created_at", { ascending: false }),
  ]);

  return (
    <DashboardClient
      initialCustomers={customers ?? []}
      initialTransactions={transactions ?? []}
    />
  );
}
