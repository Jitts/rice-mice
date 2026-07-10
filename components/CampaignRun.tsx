"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { channelDef, sendLink, type Campaign } from "@/lib/campaigns";

export type RunRow = {
  id: string;
  customer_id: string | null;
  channel: string;
  message_draft: string;
  sent_at: string | null;
  sent_by: string | null;
  customers: {
    id: string;
    first_name: string;
    last_name: string;
    phone: string | null;
    email: string | null;
    whatsapp_opt_in: boolean;
    email_opt_in: boolean;
  } | null;
};

// Consent is re-checked at send time, not just at approval: a customer who
// unsubscribed after the run was created renders as skipped, never sendable.
function liveAddress(campaign: Campaign, row: RunRow): string | null {
  const c = row.customers;
  if (!c) return null;
  if (campaign.channel === "whatsapp")
    return c.whatsapp_opt_in && c.phone ? c.phone : null;
  if (campaign.channel === "email")
    return c.email_opt_in && c.email ? c.email : null;
  return null;
}

export function CampaignRun({
  campaign,
  initialRows,
}: {
  campaign: Campaign;
  initialRows: RunRow[];
}) {
  const [supabase] = useState(() => createClient());
  const [rows, setRows] = useState<RunRow[]>(initialRows);
  const [staffName, setStaffName] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  const ch = channelDef(campaign.channel);
  const sentCount = useMemo(() => rows.filter((r) => r.sent_at).length, [rows]);
  const sendable = useMemo(
    () => rows.filter((r) => !r.sent_at && liveAddress(campaign, r) !== null),
    [rows, campaign],
  );

  async function markSent(row: RunRow) {
    if (row.sent_at) return;
    const now = new Date().toISOString();
    const by = staffName.trim() || null;
    setRows((rs) =>
      rs.map((r) => (r.id === row.id ? { ...r, sent_at: now, sent_by: by } : r)),
    );
    await supabase
      .from("engagement_logs")
      .update({ sent_at: now, sent_by: by })
      .eq("id", row.id);
    if (row.customer_id) {
      await supabase
        .from("customers")
        .update({ last_contacted_at: now })
        .eq("id", row.customer_id);
    }
    // Last one out stamps the campaign complete.
    const remaining = rows.filter((r) => !r.sent_at && r.id !== row.id).length;
    if (remaining === 0 && !campaign.completed_at) {
      await supabase
        .from("campaigns")
        .update({ completed_at: now })
        .eq("id", campaign.id);
    }
  }

  return (
    <main className="min-h-screen p-8 max-w-3xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{campaign.name}</h1>
          <p className="text-sm text-neutral-500">
            {ch.label} · segment “{campaign.segment_name}” ·{" "}
            {new Date(campaign.created_at).toLocaleDateString()}
          </p>
        </div>
        <nav className="flex gap-4 text-sm text-neutral-500">
          <Link href="/dashboard/campaigns" className="underline">Campaigns</Link>
          <Link href="/dashboard/segments" className="underline">Segments</Link>
        </nav>
      </div>

      <div className="rounded-lg border border-neutral-200 bg-white p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm text-neutral-600">
            <span className="text-xl font-semibold text-neutral-900">{sentCount}</span>
            {" "}of {rows.length} sent
          </span>
          {sentCount === rows.length && rows.length > 0 ? (
            <span className="text-sm text-emerald-600 font-medium">
              Campaign complete
            </span>
          ) : (
            <span className="text-xs text-neutral-400">
              Click a row&apos;s send button — it opens{" "}
              {campaign.channel === "email" ? "your mail app" : "WhatsApp"} with the
              message ready; you press send there.
            </span>
          )}
        </div>
        <div className="h-2 rounded bg-neutral-100 overflow-hidden">
          <div
            className="h-full bg-emerald-500 transition-all"
            style={{
              width: rows.length ? `${(sentCount / rows.length) * 100}%` : "0%",
            }}
          />
        </div>
        <div className="mt-3 flex items-center gap-2">
          <label className="text-xs text-neutral-500">Sending as</label>
          <input
            value={staffName}
            onChange={(e) => setStaffName(e.target.value)}
            placeholder="Your name (logged on each send)"
            className="border border-neutral-300 rounded px-2 py-1 text-sm w-56"
          />
        </div>
      </div>

      <div className="rounded-lg border border-neutral-200 bg-white divide-y">
        {rows.map((row) => {
          const c = row.customers;
          const addr = liveAddress(campaign, row);
          const link = addr
            ? sendLink(campaign.channel, addr, campaign.subject, row.message_draft)
            : null;
          const isOpen = expanded === row.id;
          return (
            <div key={row.id} className="px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <button
                  onClick={() => setExpanded(isOpen ? null : row.id)}
                  className="text-left text-sm flex-1"
                >
                  <span className="font-medium">
                    {c ? `${c.first_name} ${c.last_name}` : "Deleted customer"}
                  </span>
                  <span className="text-neutral-400 ml-2">{addr ?? ""}</span>
                </button>
                {row.sent_at ? (
                  <span className="text-xs text-emerald-600 whitespace-nowrap">
                    Sent {new Date(row.sent_at).toLocaleTimeString()}
                    {row.sent_by ? ` by ${row.sent_by}` : ""}
                  </span>
                ) : link ? (
                  <a
                    href={link}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => markSent(row)}
                    className="text-sm bg-neutral-900 text-white rounded px-3 py-1.5 whitespace-nowrap"
                  >
                    Open &amp; mark sent
                  </a>
                ) : (
                  <span className="text-xs text-neutral-400 whitespace-nowrap">
                    Skipped — unsubscribed or unreachable
                  </span>
                )}
              </div>
              {isOpen && (
                <p className="text-xs text-neutral-500 whitespace-pre-wrap mt-2 border-t pt-2">
                  {row.message_draft}
                </p>
              )}
            </div>
          );
        })}
      </div>

      {sendable.length === 0 && sentCount < rows.length && (
        <p className="text-sm text-neutral-500">
          The remaining recipients unsubscribed or lost their contact info since this
          run was created — they can&apos;t be sent to.
        </p>
      )}
    </main>
  );
}
