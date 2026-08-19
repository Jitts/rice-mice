import { createClient } from "@/lib/supabase/server";
import { connectedChannels, getWhatsAppConfig } from "@/lib/providerConfig";
import { callerBusinessId } from "@/lib/tenant";
import { channelStatuses } from "@/lib/campaigns";
import { CampaignComposer } from "@/components/CampaignComposer";
import type { SavedSegment } from "@/components/SegmentsManager";
import type { CustomFieldRow, CustomerRow, ProfileAggregateRow } from "@/lib/segments";
import { readAll } from "@/lib/supabase/readAll";
import { analystKeyEnvName, analystKeyPresent } from "@/lib/analystModel";

export const dynamic = "force-dynamic";

export default async function NewCampaignPage({
  searchParams,
}: {
  searchParams: Promise<{ segment?: string }>;
}) {
  const { segment } = await searchParams;
  const supabase = await createClient();

  const businessId = await callerBusinessId();

  // Sprint 50: the composer never renders an order, only the per-customer
  // roll-up behind the audience. Both reads must be COMPLETE — approve() writes
  // one engagement_logs row per recipient it holds and stamps recipient_count
  // from that array, so a short read would send to a subset and record it as
  // the whole audience.
  const [customersRead, aggregateRead, { data: segments }, { data: customFields }, connected, whatsapp] =
    await Promise.all([
      readAll<CustomerRow>("of your customers", (from, to) =>
        supabase
          .from("customers")
          .select("*", { count: "exact" })
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
      supabase.from("segments").select("*").order("updated_at", { ascending: false }),
      supabase.from("custom_fields").select("*").order("sort_order"),
      // Live provider connection status → which channels the composer may offer.
      connectedChannels(businessId),
      // Sprint 62: the approved template NAME and variable order. Not secret,
      // and the composer cannot tell the truth about a WhatsApp send without it.
      getWhatsAppConfig(businessId),
    ]);

  if (!customersRead.ok) throw new Error(customersRead.error);
  if (!aggregateRead.ok) throw new Error(aggregateRead.error);

  return (
    <CampaignComposer
      initialCustomers={customersRead.rows}
      initialAggregate={aggregateRead.rows}
      segments={(segments ?? []) as SavedSegment[]}
      initialSegmentId={segment}
      initialCustomFields={(customFields ?? []) as CustomFieldRow[]}
      // Computed server-side from channel_providers; only labels/booleans reach the client.
      channels={channelStatuses(connected)}
      whatsappTemplate={
        whatsapp ? { name: whatsapp.templateName, vars: whatsapp.templateVars } : null
      }
      analystReady={analystKeyPresent()}
      assistantKeyName={analystKeyEnvName()}
    />
  );
}
