import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { channelDef, type Campaign } from "@/lib/campaigns";

export const dynamic = "force-dynamic";

export default async function CampaignsPage() {
  const supabase = await createClient();

  const [{ data: campaigns }, { data: logs }] = await Promise.all([
    supabase.from("campaigns").select("*").order("created_at", { ascending: false }),
    supabase
      .from("engagement_logs")
      .select("campaign_id, sent_at")
      .not("campaign_id", "is", null),
  ]);

  const sentByCampaign = new Map<string, number>();
  for (const l of logs ?? []) {
    if (!l.sent_at || !l.campaign_id) continue;
    sentByCampaign.set(l.campaign_id, (sentByCampaign.get(l.campaign_id) ?? 0) + 1);
  }

  const list = (campaigns ?? []) as Campaign[];

  return (
    <main className="min-h-screen p-8 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Campaigns</h1>
        <nav className="flex gap-4 text-sm text-neutral-500 items-center">
          <Link href="/dashboard/segments" className="underline">Segments</Link>
          <Link href="/dashboard" className="underline">Dashboard</Link>
          <Link
            href="/dashboard/campaigns/new"
            className="bg-black text-white rounded px-4 py-2 no-underline"
          >
            New campaign
          </Link>
        </nav>
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
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="text-left border-b text-neutral-500">
              <th className="py-2 font-medium">Campaign</th>
              <th className="py-2 font-medium">Segment</th>
              <th className="py-2 font-medium">Channel</th>
              <th className="py-2 font-medium">Progress</th>
              <th className="py-2 font-medium">Created</th>
            </tr>
          </thead>
          <tbody>
            {list.map((c) => {
              const sent = sentByCampaign.get(c.id) ?? 0;
              return (
                <tr key={c.id} className="border-b">
                  <td className="py-2 font-medium">
                    <Link
                      href={`/dashboard/campaigns/${c.id}`}
                      className="hover:underline"
                    >
                      {c.name}
                    </Link>
                  </td>
                  <td className="py-2 text-neutral-500">{c.segment_name}</td>
                  <td className="py-2">{channelDef(c.channel).label}</td>
                  <td className="py-2">
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
                  <td className="py-2 text-neutral-500">
                    {new Date(c.created_at).toLocaleDateString()}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </main>
  );
}
