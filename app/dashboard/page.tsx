import { createClient } from "@/lib/supabase/server";
import { readAll } from "@/lib/supabase/readAll";
import type { Order } from "@/lib/orders";
import type { CustomerRow } from "@/lib/segments";
import { emailProviderReady } from "@/lib/providerConfig";
import { callerBusinessId } from "@/lib/tenant";
import { DashboardClient } from "@/components/DashboardClient";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const supabase = await createClient();

  const [
    customersRead,
    ordersRead,
    { data: customFields },
    { data: segments },
    { data: inboxActions },
  ] = await Promise.all([
    // ponytail: still ships every customer and every order to the browser, which
    // is what the client-side sort, search and 25-row pager work over. readAll
    // makes it complete-or-loud rather than silently truncated (Sprint 49); it
    // does NOT make it small. Ceiling: payload grows with the shop's whole
    // history. Upgrade when a page load measurably drags — server-paginate the
    // tables and move the loyalty sort into SQL, since it is derived from order
    // count and spend and cannot be paged from customers alone.
    readAll<CustomerRow>("of your customers", (from, to) =>
      supabase
        .from("customers")
        .select("*", { count: "exact" })
        .order("created_at", { ascending: false })
        .order("id")
        .range(from, to),
    ),
    readAll<Order>("of your orders", (from, to) =>
      supabase
        .from("orders")
        .select("*, order_items(*)", { count: "exact" })
        .order("created_at", { ascending: false })
        .order("id")
        .range(from, to),
    ),
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

  // Every stat card and the at-risk badge come off these two. A short read
  // would show a confident wrong revenue figure.
  if (!customersRead.ok) throw new Error(customersRead.error);
  if (!ordersRead.ok) throw new Error(ordersRead.error);

  return (
    <DashboardClient
      initialCustomers={customersRead.rows}
      initialOrders={ordersRead.rows}
      customFieldDefs={customFields ?? []}
      segments={segments ?? []}
      inboxActions={(inboxActions ?? []) as never[]}
      // Evaluated server-side; only the boolean reaches the client.
      emailReady={await emailProviderReady(await callerBusinessId())}
    />
  );
}
