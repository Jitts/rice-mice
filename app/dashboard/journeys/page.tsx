import { createClient } from "@/lib/supabase/server";
import {
  JourneysManager,
  type OfferCampaign,
  type RunStub,
} from "@/components/JourneysManager";
import type { Journey } from "@/lib/journeys";
import type { CustomerRow } from "@/lib/segments";

export const dynamic = "force-dynamic";

export default async function JourneysPage() {
  const supabase = await createClient();

  const [
    { data: journeys },
    { data: runs },
    { data: customers },
    { data: orders },
    { data: offerCampaigns },
  ] = await Promise.all([
    supabase.from("journeys").select("*").order("updated_at", { ascending: false }),
    supabase.from("journey_runs").select("id, journey_id, status"),
    supabase.from("customers").select("*").order("created_at", { ascending: false }),
    supabase.from("orders").select("*, order_items(*)"),
    supabase
      .from("campaigns")
      .select("id, name, offer_code")
      .not("offer_code", "is", null)
      .order("created_at", { ascending: false }),
  ]);

  return (
    <JourneysManager
      initialJourneys={(journeys ?? []) as Journey[]}
      initialRuns={(runs ?? []) as RunStub[]}
      initialCustomers={(customers ?? []) as CustomerRow[]}
      initialOrders={orders ?? []}
      offerCampaigns={(offerCampaigns ?? []) as OfferCampaign[]}
    />
  );
}
