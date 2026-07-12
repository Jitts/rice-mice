import { createClient } from "@/lib/supabase/server";
import { DashboardClient } from "@/components/DashboardClient";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const supabase = await createClient();

  const [
    { data: customers },
    { data: orders },
    { data: customFields },
    { data: segments },
    { data: inboxActions },
  ] = await Promise.all([
    supabase
      .from("customers")
      .select("*")
      .order("created_at", { ascending: false }),
    supabase
      .from("orders")
      .select("*, order_items(*)")
      .order("created_at", { ascending: false }),
    supabase.from("custom_fields").select("key, label, value_type").order("sort_order"),
    supabase.from("segments").select("id, name"),
    supabase
      .from("journey_actions")
      .select(
        "id, created_at, customer_id, journey_id, payload, status, customers(first_name, last_name, phone, email, whatsapp_opt_in, email_opt_in)",
      )
      .eq("status", "pending")
      .order("created_at", { ascending: false }),
  ]);

  return (
    <DashboardClient
      initialCustomers={customers ?? []}
      initialOrders={orders ?? []}
      customFieldDefs={customFields ?? []}
      segments={segments ?? []}
      inboxActions={(inboxActions ?? []) as never[]}
      // Evaluated server-side; only the boolean reaches the client.
      emailReady={!!process.env.RESEND_API_KEY}
    />
  );
}
