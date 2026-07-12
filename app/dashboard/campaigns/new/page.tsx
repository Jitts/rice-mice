import { createClient } from "@/lib/supabase/server";
import { emailProviderReady } from "@/lib/providerConfig";
import { CampaignComposer } from "@/components/CampaignComposer";
import type { SavedSegment } from "@/components/SegmentsManager";
import type { CustomFieldRow } from "@/lib/segments";

export const dynamic = "force-dynamic";

export default async function NewCampaignPage({
  searchParams,
}: {
  searchParams: Promise<{ segment?: string }>;
}) {
  const { segment } = await searchParams;
  const supabase = await createClient();

  const [{ data: customers }, { data: orders }, { data: segments }, { data: customFields }] =
    await Promise.all([
      supabase.from("customers").select("*").order("created_at", { ascending: false }),
      supabase.from("orders").select("*, order_items(*)").order("created_at", { ascending: false }),
      supabase.from("segments").select("*").order("updated_at", { ascending: false }),
      supabase.from("custom_fields").select("*").order("sort_order"),
    ]);

  return (
    <CampaignComposer
      initialCustomers={customers ?? []}
      initialOrders={orders ?? []}
      segments={(segments ?? []) as SavedSegment[]}
      initialSegmentId={segment}
      initialCustomFields={(customFields ?? []) as CustomFieldRow[]}
      // Evaluated server-side; only the boolean reaches the client.
      emailReady={await emailProviderReady()}
    />
  );
}
