import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { channelDef, type Campaign } from "@/lib/campaigns";
import { attributeCampaign, type SentLog } from "@/lib/attribution";
import { formatCents } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function CampaignsPage() {
  const supabase = await createClient();

  const [{ data: campaigns }, { data: logs }, { data: orders }] = await Promise.all([
    supabase.from("campaigns").select("*").order("created_at", { ascending: false }),
    supabase
      .from("engagement_logs")
      .select("campaign_id, customer_id, sent_at")
      .not("campaign_id", "is", null),
    supabase
      .from("orders")
      .select("customer_id, status, created_at, total_cents")
      .eq("status", "completed"),
  ]);

  const logsByCampaign = new Map<string, SentLog[]>();
  for (const l of logs ?? []) {
    if (!l.campaign_id) continue;
    const list = logsByCampaign.get(l.campaign_id) ?? [];
    list.push(l);
    logsByCampaign.set(l.campaign_id, list);
  }
  const resultsFor = (id: string) =>
    attributeCampaign(logsByCampaign.get(id) ?? [], orders ?? []);

  const list = (campaigns ?? []) as Campaign[];

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Campaigns</h1>
        <Link
          href="/dashboard/campaigns/new"
          className="text-sm bg-neutral-900 text-white rounded-lg px-4 py-2 hover:bg-neutral-700"
        >
          New campaign
        </Link>
      </div>

      {list.length === 0 ? (
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
                <th className="px-4 py-2.5 font-medium">Progress</th>
                <th className="px-4 py-2.5 font-medium">Came back</th>
                <th className="px-4 py-2.5 font-medium">Revenue after</th>
                <th className="px-4 py-2.5 font-medium">Created</th>
              </tr>
            </thead>
            <tbody>
              {list.map((c) => {
                const results = resultsFor(c.id);
                const sent = results.sentCount;
                return (
                  <tr
                    key={c.id}
                    className="border-b border-neutral-100 last:border-0 hover:bg-neutral-50"
                  >
                    <td className="px-4 py-2.5 font-medium">
                      <Link
                        href={`/dashboard/campaigns/${c.id}`}
                        className="hover:underline"
                      >
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
                      {sent > 0 ? (
                        <>
                          {results.returnedCount}
                          <span className="text-neutral-400 text-xs ml-1">
                            ({Math.round((results.returnedCount / sent) * 100)}%)
                          </span>
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
      )}
    </div>
  );
}
