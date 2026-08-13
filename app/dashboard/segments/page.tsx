import { createClient } from "@/lib/supabase/server";
import { callerBusinessId } from "@/lib/tenant";
import { readAll } from "@/lib/supabase/readAll";
import { SegmentsManager, type SavedSegment } from "@/components/SegmentsManager";
import { analystKeyEnvName, analystKeyPresent } from "@/lib/analystModel";
import type { CustomFieldRow, CustomerRow, ProfileAggregateRow } from "@/lib/segments";

export const dynamic = "force-dynamic";

export default async function SegmentsPage() {
  const supabase = await createClient();
  const businessId = await callerBusinessId();

  // Sprint 50: the orders table used to come down whole, with every line item,
  // so the browser could rebuild profiles. This page never renders an order —
  // it only needs the per-customer roll-up, which is one row each instead of
  // one per line. Both reads must be COMPLETE: the CSV export writes every
  // matched customer, not the 30 on screen, so a short read would quietly
  // export a subset.
  const [customersRead, aggregateRead, { data: items }, { data: segments }, { data: customFields }] =
    await Promise.all([
      readAll<CustomerRow>("of your customers", (from, to) =>
        supabase
          .from("customers")
          .select("*", { count: "exact" })
          // created_at desc is the display order the matched table inherits;
          // id is the tiebreak that makes paging deterministic.
          .order("created_at", { ascending: false })
          .order("id")
          .range(from, to),
      ),
      readAll<ProfileAggregateRow>("of your customers' order history", (from, to) =>
        supabase
          .rpc("customer_profile_aggregate", { p_business: businessId }, { count: "exact" })
          .order("customer_id")
          .range(from, to),
      ),
      supabase.from("items").select("name").eq("is_active", true).order("sort_order"),
      supabase.from("segments").select("*").order("updated_at", { ascending: false }),
      supabase.from("custom_fields").select("*").order("sort_order"),
    ]);

  // Loud beats a page of wrong counts. Segment sizes drive who gets messaged.
  if (!customersRead.ok) throw new Error(customersRead.error);
  if (!aggregateRead.ok) throw new Error(aggregateRead.error);

  return (
    <SegmentsManager
      initialCustomers={customersRead.rows}
      initialAggregate={aggregateRead.rows}
      itemNames={(items ?? []).map((i) => i.name as string)}
      initialSegments={(segments ?? []) as SavedSegment[]}
      initialCustomFields={(customFields ?? []) as CustomFieldRow[]}
      assistantReady={analystKeyPresent()}
      assistantKeyName={analystKeyEnvName()}
    />
  );
}
