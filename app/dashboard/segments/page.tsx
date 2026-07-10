import { createClient } from "@/lib/supabase/server";
import { SegmentsManager, type SavedSegment } from "@/components/SegmentsManager";
import type { CustomFieldRow } from "@/lib/segments";

export const dynamic = "force-dynamic";

export default async function SegmentsPage() {
  const supabase = await createClient();

  const [{ data: customers }, { data: orders }, { data: items }, { data: segments }, { data: customFields }] =
    await Promise.all([
      supabase.from("customers").select("*").order("created_at", { ascending: false }),
      supabase.from("orders").select("*, order_items(*)").order("created_at", { ascending: false }),
      supabase.from("items").select("name").eq("is_active", true).order("sort_order"),
      supabase.from("segments").select("*").order("updated_at", { ascending: false }),
      supabase.from("custom_fields").select("*").order("sort_order"),
    ]);

  return (
    <SegmentsManager
      initialCustomers={customers ?? []}
      initialOrders={orders ?? []}
      itemNames={(items ?? []).map((i) => i.name as string)}
      initialSegments={(segments ?? []) as SavedSegment[]}
      initialCustomFields={(customFields ?? []) as CustomFieldRow[]}
    />
  );
}
