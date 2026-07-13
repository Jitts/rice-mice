"use client";

import { useState } from "react";
import Link from "next/link";
import { channelDef, type Campaign } from "@/lib/campaigns";
import { attributeCampaign } from "@/lib/attribution";
import { formatCents } from "@/lib/format";
import { glossaryById } from "@/lib/glossary";
import { useLoyalty, useRules } from "@/components/RulesContext";
import { InfoTip } from "@/components/InfoTip";
import {
  JourneysManager,
  type JourneyLogRow,
  type OfferCampaign,
  type RunStub,
} from "@/components/JourneysManager";
import type { Journey } from "@/lib/journeys";
import type { CustomerRow, CustomFieldRow } from "@/lib/segments";
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
  segments,
  customFields,
  offerCampaigns,
  initialSegmentId,
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
}) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const rules = useRules();
  const loyalty = useLoyalty();
  const glossary = glossaryById(rules, loyalty);

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
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Campaigns</h1>
        {tab === "onetime" && (
          <Link
            href="/dashboard/campaigns/new"
            className="text-sm bg-neutral-900 text-white rounded-lg px-4 py-2 hover:bg-neutral-700"
          >
            New campaign
          </Link>
        )}
      </div>

      <div className="inline-flex rounded-lg border border-neutral-300 overflow-hidden">
        <button
          onClick={() => setTab("onetime")}
          className={`px-4 py-1.5 text-sm ${
            tab === "onetime" ? "bg-neutral-900 text-white" : "bg-white text-neutral-600"
          }`}
        >
          One-time sends
        </button>
        <button
          onClick={() => setTab("journeys")}
          className={`px-4 py-1.5 text-sm ${
            tab === "journeys" ? "bg-neutral-900 text-white" : "bg-white text-neutral-600"
          }`}
        >
          Journeys
          <InfoTip term="journey" align="right" />
        </button>
      </div>

      {tab === "onetime" ? (
        campaigns.length === 0 ? (
          <p className="text-neutral-500">
            No campaigns yet.{" "}
            <Link href="/dashboard/campaigns/new" className="underline">
              Create your first one
            </Link>{" "}
            — pick a segment, write the message, and send it customer by customer.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b border-neutral-200 bg-neutral-50 text-neutral-500">
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
                      className="border-b border-neutral-100 last:border-0 hover:bg-neutral-50"
                    >
                      <td className="px-4 py-2.5 font-medium">
                        <Link href={`/dashboard/campaigns/${c.id}`} className="hover:underline">
                          {c.name}
                        </Link>
                      </td>
                      <td className="px-4 py-2.5 text-neutral-500">{c.segment_name}</td>
                      <td className="px-4 py-2.5">{channelDef(c.channel).label}</td>
                      <td className="px-4 py-2.5">
                        {c.completed_at ? (
                          <span className="text-xs rounded-full px-2 py-0.5 bg-green-100 text-green-700">
                            Complete ({c.recipient_count})
                          </span>
                        ) : (
                          <span className="text-xs rounded-full px-2 py-0.5 bg-amber-100 text-amber-700">
                            {sent} / {c.recipient_count} sent
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        {sent > 0 || results.redeemedCount > 0 ? (
                          <>
                            {results.returnedCount}
                            {sent > 0 && (
                              <span className="text-neutral-400 text-xs ml-1">
                                ({Math.round((results.returnedCount / sent) * 100)}%)
                              </span>
                            )}
                            {results.redeemedCount > 0 && (
                              <span className="text-violet-600 text-xs ml-1">
                                · {results.redeemedCount} redeemed
                              </span>
                            )}
                          </>
                        ) : (
                          <span className="text-neutral-300">—</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        {results.attributedCents > 0 ? (
                          <span className="text-emerald-600 font-medium">
                            {formatCents(results.attributedCents)}
                          </span>
                        ) : (
                          <span className="text-neutral-300">—</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-neutral-500">
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
  );
}
