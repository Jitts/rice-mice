import { createClient } from "@/lib/supabase/server";
import { CampaignComposer } from "@/components/CampaignComposer";
import type { SavedSegment } from "@/components/SegmentsManager";

export const dynamic = "force-dynamic";

export default async function NewCampaignPage({
  searchParams,
}: {
  searchParams: Promise<{ segment?: string }>;
}) {
  const { segment } = await searchParams;
  const supabase = await createClient();

  const [{ data: customers }, { data: orders }, { data: segments }] =
    await Promise.all([
      supabase.from("customers").select("*").order("created_at", { ascending: false }),
      supabase.from("orders").select("*, order_items(*)").order("created_at", { ascending: false }),
      supabase.from("segments").select("*").order("updated_at", { ascending: false }),
    ]);

  return (
    <CampaignComposer
      initialCustomers={customers ?? []}
      initialOrders={orders ?? []}
      segments={(segments ?? []) as SavedSegment[]}
      initialSegmentId={segment}
    />
  );
}
