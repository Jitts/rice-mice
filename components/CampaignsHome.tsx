"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { channelDef, type Campaign } from "@/lib/campaigns";
import { attributeCampaign } from "@/lib/attribution";
import { formatCents } from "@/lib/format";
import { glossaryById } from "@/lib/glossary";
import { useLoyalty, useRules } from "@/components/RulesContext";
import { InfoTip } from "@/components/InfoTip";
import { AnalystRail } from "@/components/AnalystRail";
import { PlannerChat } from "@/components/PlannerChat";
import { CAMPAIGN_HANDOFF_KEY, type CampaignHandoff, type PlannerPlan } from "@/lib/plannerAgent";
import {
  JourneysManager,
  type JourneyLogRow,
  type JourneysManagerHandle,
  type OfferCampaign,
  type RunStub,
} from "@/components/JourneysManager";
import type { Journey } from "@/lib/journeys";
import {
  buildFieldRegistry,
  buildProfiles,
  filterProfiles,
  isReachable,
  EMPTY_DEFINITION,
  type CustomerRow,
  type CustomFieldRow,
} from "@/lib/segments";
import type { SavedSegment } from "@/components/SegmentsManager";
import type { Order } from "@/lib/orders";

export type Tab = "onetime" | "journeys";

// One shared query pulls all engagement_logs (see app/dashboard/campaigns/page.tsx);
// each row belongs to a one-time campaign OR a journey, never both.
export type EngagementLogRow = {
  campaign_id: string | null;
  journey_id: string | null;
  customer_id: string | null;
  sent_at: string | null;
};

export function CampaignsHome({
  initialTab,
  campaigns,
  campaignLogs,
  orders,
  journeys,
  journeyRuns,
  journeyLogs,
  customers,
  segments: initialSegments,
  customFields,
  offerCampaigns,
  initialSegmentId,
  assistantReady = false,
  assistantKeyName = "",
}: {
  initialTab: Tab;
  campaigns: Campaign[];
  campaignLogs: EngagementLogRow[];
  orders: Order[];
  journeys: Journey[];
  journeyRuns: RunStub[];
  journeyLogs: JourneyLogRow[];
  customers: CustomerRow[];
  segments: SavedSegment[];
  customFields: CustomFieldRow[];
  offerCampaigns: OfferCampaign[];
  initialSegmentId?: string;
  assistantReady?: boolean;
  assistantKeyName?: string;
}) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const router = useRouter();
  const [supabase] = useState(() => createClient());
  const rules = useRules();
  const loyalty = useLoyalty();
  const glossary = glossaryById(rules, loyalty);

  // One planner chat, shared by both tabs (in the rail below) — this is the
  // single source of truth for "what segments exist" that its plans get
  // checked against, so it has to survive a tab toggle rather than being
  // owned by whichever tab happens to be mounted.
  const [segments, setSegments] = useState<SavedSegment[]>(initialSegments);
  const [applyError, setApplyError] = useState<string | null>(null);
  const journeysRef = useRef<JourneysManagerHandle>(null);

  const profiles = useMemo(() => buildProfiles(customers, orders), [customers, orders]);
  const fieldRegistry = useMemo(() => buildFieldRegistry(customFields), [customFields]);
  const segmentsById = useMemo(
    () => Object.fromEntries(segments.map((s) => [s.id, s.definition ?? EMPTY_DEFINITION])),
    [segments],
  );

  function planCounts(plan: PlannerPlan) {
    const m = filterProfiles(plan.definition, profiles, fieldRegistry.byId, segmentsById);
    return { matched: m.length, reachable: m.filter(isReachable).length };
  }

  // Where "Apply" goes depends on which tab is showing, since only Journeys
  // has a compose surface mounted here — One-time sends is just a list, the
  // actual composer is the separate /campaigns/new page. Journey plans hand
  // off to the canvas via the ref; campaign plans save the audience and
  // route to New Campaign, which already knows how to preselect a segment
  // via ?segment=. Channel/name/subject/body have nowhere to live in a URL
  // param cleanly (body can run to 1200 chars), so they ride along in
  // sessionStorage instead — CampaignComposer picks the handoff up on mount.
  async function applyPlan(plan: PlannerPlan) {
    if (tab === "journeys") {
      await journeysRef.current?.applyPlan(plan);
      return;
    }
    setApplyError(null);
    const id = crypto.randomUUID();
    const segName = plan.name.slice(0, 60);
    const { error } = await supabase
      .from("segments")
      .insert({ id, name: segName, definition: plan.definition });
    if (error) {
      setApplyError("Couldn't save the assistant's audience — try again.");
      return;
    }
    setSegments((list) => [
      {
        id,
        name: segName,
        definition: plan.definition,
        is_starter: false,
        updated_at: new Date().toISOString(),
      },
      ...list,
    ]);
    try {
      const handoff: CampaignHandoff = {
        segmentId: id,
        channel: plan.channel ?? "whatsapp",
        name: plan.name,
        subject: plan.subject ?? null,
        body: plan.body ?? "",
      };
      sessionStorage.setItem(CAMPAIGN_HANDOFF_KEY, JSON.stringify(handoff));
    } catch {
      // Private mode / storage disabled — the composer still gets the
      // segment via the query param, just not the channel/copy.
    }
    router.push(`/dashboard/campaigns/new?segment=${id}`);
  }

  const logsByCampaign = new Map<string, EngagementLogRow[]>();
  for (const l of campaignLogs) {
    if (!l.campaign_id) continue;
    const list = logsByCampaign.get(l.campaign_id) ?? [];
    list.push(l);
    logsByCampaign.set(l.campaign_id, list);
  }
  const resultsFor = (id: string) =>
    attributeCampaign(
      logsByCampaign.get(id) ?? [],
      orders,
      rules.attribution_window_days,
      id,
    );

  return (
    <AnalystRail
      title="Ask the assistant"
      panel={
        <PlannerChat
          mode={tab === "journeys" ? "journey" : "campaign"}
          ready={assistantReady}
          keyName={assistantKeyName}
          matchCount={planCounts}
          onApply={applyPlan}
          embedded
        />
      }
    >
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="font-heading text-2xl font-bold tracking-tight">Campaigns</h1>
        {tab === "onetime" && (
          <Link
            href="/dashboard/campaigns/new"
            className="text-sm bg-primary text-primary-foreground rounded-lg px-4 py-2 hover:bg-primary/90"
          >
            New campaign
          </Link>
        )}
      </div>

      <div className="inline-flex rounded-lg border border-input overflow-hidden">
        <button
          onClick={() => setTab("onetime")}
          className={`px-4 py-1.5 text-sm ${
            tab === "onetime" ? "bg-primary text-primary-foreground" : "bg-card text-muted-foreground"
          }`}
        >
          One-time sends
        </button>
        <button
          onClick={() => setTab("journeys")}
          className={`px-4 py-1.5 text-sm ${
            tab === "journeys" ? "bg-primary text-primary-foreground" : "bg-card text-muted-foreground"
          }`}
        >
          Journeys
          <InfoTip term="journey" align="right" />
        </button>
      </div>

      {applyError && <p className="text-sm text-destructive">{applyError}</p>}

      {tab === "onetime" ? (
        campaigns.length === 0 ? (
          <p className="text-muted-foreground">
            No campaigns yet.{" "}
            <Link href="/dashboard/campaigns/new" className="underline">
              Create your first one
            </Link>{" "}
            — pick a segment, write the message, and send it customer by customer.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border bg-card">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b border-border bg-muted text-muted-foreground">
                  <th className="px-4 py-2.5 font-medium">Campaign</th>
                  <th className="px-4 py-2.5 font-medium">Segment</th>
                  <th className="px-4 py-2.5 font-medium">Channel</th>
                  <th className="px-4 py-2.5 font-medium" title={glossary.sent.how}>
                    Progress
                  </th>
                  <th
                    className="px-4 py-2.5 font-medium underline decoration-dotted decoration-neutral-300 underline-offset-2 cursor-help"
                    title={`${glossary.came_back.short} ${glossary.came_back.how}`}
                  >
                    Came back
                  </th>
                  <th
                    className="px-4 py-2.5 font-medium underline decoration-dotted decoration-neutral-300 underline-offset-2 cursor-help"
                    title={`${glossary.revenue_after_send.short} ${glossary.revenue_after_send.how}`}
                  >
                    Revenue after
                  </th>
                  <th className="px-4 py-2.5 font-medium">Created</th>
                </tr>
              </thead>
              <tbody>
                {campaigns.map((c) => {
                  const results = resultsFor(c.id);
                  const sent = results.sentCount;
                  return (
                    <tr
                      key={c.id}
                      className="border-b border-border/60 last:border-0 hover:bg-muted"
                    >
                      <td className="px-4 py-2.5 font-medium">
                        <Link href={`/dashboard/campaigns/${c.id}`} className="hover:underline">
                          {c.name}
                        </Link>
                      </td>
                      <td className="px-4 py-2.5 text-muted-foreground">{c.segment_name}</td>
                      <td className="px-4 py-2.5">{channelDef(c.channel).label}</td>
                      <td className="px-4 py-2.5">
                        {c.completed_at ? (
                          <span className="text-xs rounded-full px-2 py-0.5 bg-green-100 dark:bg-green-950/50 text-green-700 dark:text-green-300">
                            Complete ({c.recipient_count})
                          </span>
                        ) : (
                          <span className="text-xs rounded-full px-2 py-0.5 bg-amber-100 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300">
                            {sent} / {c.recipient_count} sent
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        {sent > 0 || results.redeemedCount > 0 ? (
                          <>
                            {results.returnedCount}
                            {sent > 0 && (
                              <span className="text-muted-foreground/70 text-xs ml-1">
                                ({Math.round((results.returnedCount / sent) * 100)}%)
                              </span>
                            )}
                            {results.redeemedCount > 0 && (
                              <span className="text-violet-600 dark:text-violet-400 text-xs ml-1">
                                · {results.redeemedCount} redeemed
                              </span>
                            )}
                          </>
                        ) : (
                          <span className="text-muted-foreground/50">—</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        {results.attributedCents > 0 ? (
                          <span className="text-emerald-600 dark:text-emerald-400 font-medium">
                            {formatCents(results.attributedCents)}
                          </span>
                        ) : (
                          <span className="text-muted-foreground/50">—</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-muted-foreground">
                        {new Date(c.created_at).toLocaleDateString()}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )
      ) : (
        <JourneysManager
          ref={journeysRef}
          initialJourneys={journeys}
          initialCustomers={customers}
          initialOrders={orders}
          initialRuns={journeyRuns}
          initialSegments={segments}
          initialCustomFields={customFields}
          initialLogs={journeyLogs}
          offerCampaigns={offerCampaigns}
          initialSegmentId={initialSegmentId}
        />
      )}
    </div>
    </AnalystRail>
  );
}
