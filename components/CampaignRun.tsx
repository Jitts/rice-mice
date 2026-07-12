"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { channelDef, sendLink, type Campaign } from "@/lib/campaigns";
import { formatCents } from "@/lib/format";
import {
  attributeCampaign,
  ATTRIBUTION_WINDOW_DAYS,
  OUTCOMES,
  type AttributionOrder,
  type Outcome,
} from "@/lib/attribution";

export type RunRow = {
  id: string;
  customer_id: string | null;
  channel: string;
  message_draft: string;
  sent_at: string | null;
  sent_by: string | null;
  outcome: string | null;
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
  initialOrders,
}: {
  campaign: Campaign;
  initialRows: RunRow[];
  initialOrders: AttributionOrder[];
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
  const attribution = useMemo(
    () => attributeCampaign(rows, initialOrders),
    [rows, initialOrders],
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

  // Staff-observed reaction; tapping the active outcome again clears it.
  async function setOutcome(row: RunRow, outcome: Outcome) {
    const next = row.outcome === outcome ? null : outcome;
    setRows((rs) => rs.map((r) => (r.id === row.id ? { ...r, outcome: next } : r)));
    await supabase.from("engagement_logs").update({ outcome: next }).eq("id", row.id);
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{campaign.name}</h1>
          <p className="text-sm text-neutral-500">
            {ch.label} · segment “{campaign.segment_name}” ·{" "}
            {new Date(campaign.created_at).toLocaleDateString()}
          </p>
        </div>
        <Link
          href="/dashboard/campaigns"
          className="text-sm text-neutral-500 hover:text-neutral-900"
        >
          ← All campaigns
        </Link>
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

      {attribution.sentCount > 0 && (
        <div className="rounded-xl border border-neutral-200 bg-white p-4">
          <div className="flex items-baseline justify-between mb-3">
            <h2 className="text-sm font-semibold">Results</h2>
            <span className="text-xs text-neutral-400">
              completed orders within {ATTRIBUTION_WINDOW_DAYS} days of each send
            </span>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <p className="text-xs text-neutral-500">Sent</p>
              <p className="text-2xl font-semibold tracking-tight">
                {attribution.sentCount}
              </p>
            </div>
            <div>
              <p className="text-xs text-neutral-500">Came back</p>
              <p className="text-2xl font-semibold tracking-tight">
                {attribution.returnedCount}
                <span className="text-sm font-normal text-neutral-400 ml-1">
                  ({Math.round((attribution.returnedCount / attribution.sentCount) * 100)}%)
                </span>
              </p>
            </div>
            <div>
              <p className="text-xs text-neutral-500">Revenue after send</p>
              <p className="text-2xl font-semibold tracking-tight text-emerald-600">
                {formatCents(attribution.attributedCents)}
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="rounded-lg border border-neutral-200 bg-white divide-y">
        {rows.map((row) => {
          const c = row.customers;
          const addr = liveAddress(campaign, row);
          const link = addr
            ? sendLink(campaign.channel, addr, campaign.subject, row.message_draft)
            : null;
          const isOpen = expanded === row.id;
          const returned = row.customer_id
            ? attribution.byCustomer.get(row.customer_id)
            : undefined;
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
              {row.sent_at && (
                <div className="flex flex-wrap items-center gap-2 mt-2">
                  {returned ? (
                    <span className="text-xs bg-emerald-50 text-emerald-700 rounded-full px-2 py-0.5">
                      Came back · {formatCents(returned.cents)}
                      {returned.orderCount > 1 ? ` · ${returned.orderCount} orders` : ""}
                    </span>
                  ) : (
                    <span className="text-xs text-neutral-400">No return yet</span>
                  )}
                  <div className="ml-auto flex gap-1">
                    {OUTCOMES.map((o) => (
                      <button
                        key={o}
                        onClick={() => setOutcome(row, o)}
                        className={`text-xs rounded-full px-2 py-0.5 border capitalize ${
                          row.outcome === o
                            ? "bg-neutral-900 text-white border-neutral-900"
                            : "border-neutral-200 text-neutral-500 hover:border-neutral-400"
                        }`}
                      >
                        {o}
                      </button>
                    ))}
                  </div>
                </div>
              )}
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
    </div>
  );
}
