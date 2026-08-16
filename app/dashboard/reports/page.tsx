import { createClient } from "@/lib/supabase/server";
import { ReportsManager } from "@/components/ReportsManager";
import { loadFindings } from "@/lib/loadFindings";
import { analystKeyEnvName, analystKeyPresent } from "@/lib/analystModel";
import { buildCopilotEval, type CopilotLog } from "@/lib/copilotEval";
import { attributeCampaign } from "@/lib/attribution";
import { can } from "@/lib/permissions";
import type { CustomFieldRow, SegmentDefinition } from "@/lib/segments";

type SegmentStubWithDefinition = {
  id: string;
  name: string;
  definition: SegmentDefinition | null;
};

export const dynamic = "force-dynamic";

export default async function ReportsPage() {
  const supabase = await createClient();
  const { data: businessRow } = await supabase.from("businesses").select("*").maybeSingle();
  const { findings, suggestions, profiles, orders: orderRows, logs, rules } =
    await loadFindings(supabase, businessRow);

  // Sprint 52: what the create-audience dialog needs behind a finding's campaign
  // button. Both are small and bounded by what a shop defines by hand, so
  // neither wants readAll — unlike the customer and order reads inside
  // loadFindings, which have it.
  const [{ data: customFields }, { data: segmentRows }] = await Promise.all([
    supabase.from("custom_fields").select("*").order("sort_order"),
    supabase.from("segments").select("id, name, definition").order("name"),
  ]);

  // Combined post-send performance across every campaign AND journey — no
  // single row on Campaigns/Journeys shows the total, so this rolls them up
  // the same way attributeCampaign already does per-row (Sprint 41).
  const marketingTotals = attributeCampaign(logs, orderRows, rules.attribution_window_days);
  const sentLogs = logs.filter((l) => l.sent_at);
  const campaignCount = new Set(
    sentLogs.filter((l) => l.campaign_id).map((l) => l.campaign_id),
  ).size;
  const journeyCount = new Set(
    sentLogs.filter((l) => l.journey_id).map((l) => l.journey_id),
  ).size;

  // Can this caller apply the assistant's proposed tag changes? Same gate as
  // the manual tag editor — the `customers` permission. Self lookup (RLS shows
  // the whole roster, so filter to this user).
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: membershipRow } = user
    ? await supabase
        .from("memberships")
        .select("roles(permissions)")
        .eq("user_id", user.id)
        .maybeSingle()
    : { data: null };
  const perms = (membershipRow as { roles: { permissions: string[] } | null } | null)
    ?.roles?.permissions;
  const canApplyTags = can(perms, "customers");

  const copilotEval = buildCopilotEval({
    logs: logs as CopilotLog[],
    orders: orderRows,
    windowDays: rules.attribution_window_days,
  });

  return (
    <ReportsManager
      initialOrders={orderRows}
      findings={findings}
      suggestions={suggestions}
      profiles={profiles}
      customFields={(customFields ?? []) as CustomFieldRow[]}
      segments={(segmentRows ?? []) as SegmentStubWithDefinition[]}
      copilotEval={copilotEval}
      marketingTotals={{
        sentCount: marketingTotals.sentCount,
        returnedCount: marketingTotals.returnedCount,
        attributedCents: marketingTotals.attributedCents,
        campaignCount,
        journeyCount,
      }}
      analystReady={analystKeyPresent()}
      analystKeyName={analystKeyEnvName()}
      canApplyTags={canApplyTags}
    />
  );
}
