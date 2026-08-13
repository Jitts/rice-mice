import { readAll } from "@/lib/supabase/readAll";
import type { Order } from "@/lib/orders";
import type { CustomerRow } from "@/lib/segments";
import { createClient } from "@/lib/supabase/server";
import { analystKeyEnvName, analystKeyPresent } from "@/lib/analystModel";
import { CampaignsHome, type EngagementLogRow, type Tab } from "@/components/CampaignsHome";
import type { Campaign } from "@/lib/campaigns";
import type { Journey } from "@/lib/journeys";
import type { RunStub, OfferCampaign, JourneyLogRow } from "@/components/JourneysManager";
import type { SavedSegment } from "@/components/SegmentsManager";
import type { CustomFieldRow } from "@/lib/segments";

export const dynamic = "force-dynamic";

export default async function CampaignsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; segment?: string }>;
}) {
  const { tab, segment } = await searchParams;
  const supabase = await createClient();

  const [
    { data: campaigns },
    { data: logs },
    ordersRead,
    { data: journeys },
    { data: journeyRuns },
    customersRead,
    { data: segments },
    { data: customFields },
    { data: offerCampaigns },
  ] = await Promise.all([
    supabase.from("campaigns").select("*").order("created_at", { ascending: false }),
    supabase.from("engagement_logs").select("campaign_id, journey_id, customer_id, sent_at"),
    readAll<Order>("of your orders", (from, to) =>
      supabase
        .from("orders")
        .select("*, order_items(*)", { count: "exact" })
        .order("created_at", { ascending: false })
        .order("id")
        .range(from, to),
    ),
    supabase.from("journeys").select("*").order("updated_at", { ascending: false }),
    supabase.from("journey_runs").select("id, journey_id, status, position"),
    readAll<CustomerRow>("of your customers", (from, to) =>
      supabase
        .from("customers")
        .select("*", { count: "exact" })
        .order("created_at", { ascending: false })
        .order("id")
        .range(from, to),
    ),
    supabase.from("segments").select("*").order("updated_at", { ascending: false }),
    supabase.from("custom_fields").select("*").order("sort_order"),
    supabase
      .from("campaigns")
      .select("id, name, offer_code")
      .not("offer_code", "is", null)
      .order("created_at", { ascending: false }),
  ]);

  const allLogs = (logs ?? []) as EngagementLogRow[];

  if (!ordersRead.ok) throw new Error(ordersRead.error);
  if (!customersRead.ok) throw new Error(customersRead.error);

  return (
    <CampaignsHome
      initialTab={tab === "journeys" ? "journeys" : "onetime"}
      campaigns={(campaigns ?? []) as Campaign[]}
      campaignLogs={allLogs.filter((l) => l.campaign_id)}
      journeyLogs={allLogs.filter((l) => l.journey_id) as JourneyLogRow[]}
      orders={ordersRead.rows}
      journeys={(journeys ?? []) as Journey[]}
      journeyRuns={(journeyRuns ?? []) as RunStub[]}
      customers={customersRead.rows}
      segments={(segments ?? []) as SavedSegment[]}
      customFields={(customFields ?? []) as CustomFieldRow[]}
      offerCampaigns={(offerCampaigns ?? []) as OfferCampaign[]}
      initialSegmentId={segment}
      assistantReady={analystKeyPresent()}
      assistantKeyName={analystKeyEnvName()}
    />
  );
}
