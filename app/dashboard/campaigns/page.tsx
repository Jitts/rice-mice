import { createClient } from "@/lib/supabase/server";
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
    { data: orders },
    { data: journeys },
    { data: journeyRuns },
    { data: customers },
    { data: segments },
    { data: customFields },
    { data: offerCampaigns },
  ] = await Promise.all([
    supabase.from("campaigns").select("*").order("created_at", { ascending: false }),
    supabase.from("engagement_logs").select("campaign_id, journey_id, customer_id, sent_at"),
    supabase.from("orders").select("*, order_items(*)"),
    supabase.from("journeys").select("*").order("updated_at", { ascending: false }),
    supabase.from("journey_runs").select("id, journey_id, status"),
    supabase.from("customers").select("*").order("created_at", { ascending: false }),
    supabase.from("segments").select("*").order("updated_at", { ascending: false }),
    supabase.from("custom_fields").select("*").order("sort_order"),
    supabase
      .from("campaigns")
      .select("id, name, offer_code")
      .not("offer_code", "is", null)
      .order("created_at", { ascending: false }),
  ]);

  const allLogs = (logs ?? []) as EngagementLogRow[];

  return (
    <CampaignsHome
      initialTab={tab === "journeys" ? "journeys" : "onetime"}
      campaigns={(campaigns ?? []) as Campaign[]}
      campaignLogs={allLogs.filter((l) => l.campaign_id)}
      journeyLogs={allLogs.filter((l) => l.journey_id) as JourneyLogRow[]}
      orders={orders ?? []}
      journeys={(journeys ?? []) as Journey[]}
      journeyRuns={(journeyRuns ?? []) as RunStub[]}
      customers={customers ?? []}
      segments={(segments ?? []) as SavedSegment[]}
      customFields={(customFields ?? []) as CustomFieldRow[]}
      offerCampaigns={(offerCampaigns ?? []) as OfferCampaign[]}
      initialSegmentId={segment}
    />
  );
}
