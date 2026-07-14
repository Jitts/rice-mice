import { createClient } from "@/lib/supabase/server";
import { connectedChannels } from "@/lib/providerConfig";
import { callerBusinessId } from "@/lib/tenant";
import { channelStatuses } from "@/lib/campaigns";
import { CampaignComposer } from "@/components/CampaignComposer";
import type { SavedSegment } from "@/components/SegmentsManager";
import type { CustomFieldRow } from "@/lib/segments";
import { analystKeyPresent } from "@/lib/analystModel";

export const dynamic = "force-dynamic";

export default async function NewCampaignPage({
  searchParams,
}: {
  searchParams: Promise<{ segment?: string }>;
}) {
  const { segment } = await searchParams;
  const supabase = await createClient();

  const [{ data: customers }, { data: orders }, { data: segments }, { data: customFields }, connected] =
    await Promise.all([
      supabase.from("customers").select("*").order("created_at", { ascending: false }),
      supabase.from("orders").select("*, order_items(*)").order("created_at", { ascending: false }),
      supabase.from("segments").select("*").order("updated_at", { ascending: false }),
      supabase.from("custom_fields").select("*").order("sort_order"),
      // Live provider connection status → which channels the composer may offer.
      callerBusinessId().then(connectedChannels),
    ]);

  return (
    <CampaignComposer
      initialCustomers={customers ?? []}
      initialOrders={orders ?? []}
      segments={(segments ?? []) as SavedSegment[]}
      initialSegmentId={segment}
      initialCustomFields={(customFields ?? []) as CustomFieldRow[]}
      // Computed server-side from channel_providers; only labels/booleans reach the client.
      channels={channelStatuses(connected)}
      analystReady={analystKeyPresent()}
    />
  );
}
