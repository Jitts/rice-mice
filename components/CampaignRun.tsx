"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { sendCampaignEmail } from "@/app/actions/email";
import { channelDef, offerLabel, sendLink, type Campaign } from "@/lib/campaigns";
import { formatCents } from "@/lib/format";
import { InfoTip } from "@/components/InfoTip";
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
  emailReady,
}: {
  campaign: Campaign;
  initialRows: RunRow[];
  initialOrders: AttributionOrder[];
  emailReady: boolean;
}) {
  const [supabase] = useState(() => createClient());
  const [rows, setRows] = useState<RunRow[]>(initialRows);
  const [staffName, setStaffName] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [sendingAll, setSendingAll] = useState(false);
  const [sendErrors, setSendErrors] = useState<Record<string, string>>({});

  // Provider mode: the row buttons dispatch real emails from the app instead
  // of opening a mail client. Every send is still an explicit staff click.
  const providerMode = emailReady && campaign.channel === "email";

  const ch = channelDef(campaign.channel);
  const sentCount = useMemo(() => rows.filter((r) => r.sent_at).length, [rows]);
  const sendable = useMemo(
    () => rows.filter((r) => !r.sent_at && liveAddress(campaign, r) !== null),
    [rows, campaign],
  );
  const attribution = useMemo(
    () =>
      attributeCampaign(rows, initialOrders, ATTRIBUTION_WINDOW_DAYS, campaign.id),
    [rows, initialOrders, campaign.id],
  );
  const hasOffer = !!campaign.offer_code;

  function applySentLocal(id: string, now: string, by: string | null) {
    setRows((rs) =>
      rs.map((r) => (r.id === id ? { ...r, sent_at: now, sent_by: by } : r)),
    );
  }

  // Last one out stamps the campaign complete. justSent covers sends whose
  // local state update hasn't landed in the `rows` closure yet.
  async function stampCompleteIfDone(justSent: Set<string>) {
    const remaining = rows.filter((r) => !r.sent_at && !justSent.has(r.id)).length;
    if (remaining === 0 && !campaign.completed_at) {
      await supabase
        .from("campaigns")
        .update({ completed_at: new Date().toISOString() })
        .eq("id", campaign.id);
    }
  }

  async function markSent(row: RunRow) {
    if (row.sent_at) return;
    const now = new Date().toISOString();
    const by = staffName.trim() || null;
    applySentLocal(row.id, now, by);
    await supabase
      .from("engagement_logs")
      .update({ sent_at: now, sent_by: by, sent_via: "manual" })
      .eq("id", row.id);
    if (row.customer_id) {
      await supabase
        .from("customers")
        .update({ last_contacted_at: now })
        .eq("id", row.customer_id);
    }
    await stampCompleteIfDone(new Set([row.id]));
  }

  // The server action does the send + DB stamps; the client only mirrors the
  // result locally and handles campaign completion.
  async function sendOne(row: RunRow) {
    if (row.sent_at || busyId || sendingAll) return;
    setBusyId(row.id);
    setSendErrors((e) => {
      const next = { ...e };
      delete next[row.id];
      return next;
    });
    const by = staffName.trim() || null;
    const res = await sendCampaignEmail(row.id, by);
    setBusyId(null);
    if (!res.ok) {
      setSendErrors((e) => ({ ...e, [row.id]: res.error }));
      return;
    }
    applySentLocal(row.id, new Date().toISOString(), by);
    await stampCompleteIfDone(new Set([row.id]));
  }

  async function sendAllRemaining() {
    const queue = sendable;
    if (queue.length === 0 || sendingAll || busyId) return;
    if (!confirm(`Send ${queue.length} email${queue.length === 1 ? "" : "s"} now?`))
      return;
    setSendingAll(true);
    const by = staffName.trim() || null;
    const sentIds = new Set<string>();
    for (const row of queue) {
      setBusyId(row.id);
      const res = await sendCampaignEmail(row.id, by);
      if (!res.ok) {
        // Stop on the first failure so the staff sees the error in place
        // instead of a half-finished run silently skipping people.
        setSendErrors((e) => ({ ...e, [row.id]: res.error }));
        break;
      }
      applySentLocal(row.id, new Date().toISOString(), by);
      sentIds.add(row.id);
      // Resend allows ~2 requests/second — pace the loop under that.
      await new Promise((r) => setTimeout(r, 650));
    }
    setBusyId(null);
    setSendingAll(false);
    if (sentIds.size > 0) await stampCompleteIfDone(sentIds);
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
            {hasOffer && (
              <span className="ml-2 text-xs bg-violet-50 text-violet-700 rounded-full px-2 py-0.5 font-mono">
                {campaign.offer_code} · {offerLabel(campaign)}
              </span>
            )}
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
              {providerMode
                ? "Click Send email — it goes out directly from the app."
                : `Click a row's send button — it opens ${
                    campaign.channel === "email" ? "your mail app" : "WhatsApp"
                  } with the message ready; you press send there.`}
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
          {providerMode && sendable.length > 0 && (
            <button
              onClick={sendAllRemaining}
              disabled={sendingAll || busyId !== null}
              className="ml-auto text-sm bg-neutral-900 text-white rounded px-3 py-1.5 disabled:opacity-50"
            >
              {sendingAll
                ? `Sending… (${sentCount} of ${rows.length})`
                : `Send all remaining (${sendable.length})`}
            </button>
          )}
        </div>
        {campaign.channel === "email" && !emailReady && (
          <p className="mt-2 text-xs text-neutral-400">
            Manual mode — each send opens your mail app. To send directly from
            the app, connect an email provider (see docs/PROVIDERS.md).
          </p>
        )}
      </div>

      {(attribution.sentCount > 0 || attribution.redeemedCount > 0) && (
        <div className="rounded-xl border border-neutral-200 bg-white p-4">
          <div className="flex items-baseline justify-between mb-3">
            <h2 className="text-sm font-semibold">Results</h2>
            <span className="text-xs text-neutral-400">
              completed orders within {ATTRIBUTION_WINDOW_DAYS} days of each send
            </span>
          </div>
          <div className={`grid gap-3 ${hasOffer ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-3"}`}>
            <div>
              <p className="text-xs text-neutral-500">
                Sent
                <InfoTip term="sent" align="left" />
              </p>
              <p className="text-2xl font-semibold tracking-tight">
                {attribution.sentCount}
              </p>
            </div>
            <div>
              <p className="text-xs text-neutral-500">
                Came back
                <InfoTip term="came_back" />
              </p>
              <p className="text-2xl font-semibold tracking-tight">
                {attribution.returnedCount}
                {attribution.sentCount > 0 && (
                  <span className="text-sm font-normal text-neutral-400 ml-1">
                    ({Math.round((attribution.returnedCount / attribution.sentCount) * 100)}%)
                  </span>
                )}
              </p>
            </div>
            {hasOffer && (
              <div>
                <p className="text-xs text-neutral-500">
                  Redeemed
                  <InfoTip term="redeemed" />
                </p>
                <p className="text-2xl font-semibold tracking-tight text-violet-600">
                  {attribution.redeemedCount}
                  {attribution.redeemedCents > 0 && (
                    <span className="text-sm font-normal text-neutral-400 ml-1">
                      ({formatCents(attribution.redeemedCents)})
                    </span>
                  )}
                </p>
              </div>
            )}
            <div>
              <p className="text-xs text-neutral-500">
                Revenue after send
                <InfoTip term="revenue_after_send" align="right" />
              </p>
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
                ) : providerMode && addr ? (
                  <span className="flex items-center gap-2 whitespace-nowrap">
                    {link && (
                      <a
                        href={link}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={() => markSent(row)}
                        className="text-xs text-neutral-400 underline"
                        title="Fallback: open in your mail app and mark sent"
                      >
                        mail app
                      </a>
                    )}
                    <button
                      onClick={() => sendOne(row)}
                      disabled={busyId !== null || sendingAll}
                      className="text-sm bg-neutral-900 text-white rounded px-3 py-1.5 disabled:opacity-50"
                    >
                      {busyId === row.id ? "Sending…" : "Send email"}
                    </button>
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
              {sendErrors[row.id] && (
                <p className="text-xs text-red-600 mt-1">{sendErrors[row.id]}</p>
              )}
              {row.sent_at && (
                <div className="flex flex-wrap items-center gap-2 mt-2">
                  {returned ? (
                    <span
                      className={`text-xs rounded-full px-2 py-0.5 ${
                        returned.redeemed
                          ? "bg-violet-50 text-violet-700"
                          : "bg-emerald-50 text-emerald-700"
                      }`}
                    >
                      {returned.redeemed ? "Redeemed" : "Came back"} ·{" "}
                      {formatCents(returned.cents)}
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
