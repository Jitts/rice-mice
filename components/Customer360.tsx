"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { formatCents } from "@/lib/format";
import { STATUS_STYLES, type Order } from "@/lib/orders";
import {
  buildProfiles,
  stageOf,
  JOURNEY_LABELS,
  type CustomerRow,
  type JourneyStage,
} from "@/lib/segments";
import {
  buildTimeline,
  loyaltyBreakdown,
  rewardProgress,
  type EngagementSendRow,
  type SignupEventRow,
  type TimelineEvent,
} from "@/lib/customer360";
import { earningRuleText, type Reward } from "@/lib/loyalty";
import { useLoyalty, useRules } from "@/components/RulesContext";
import {
  CustomFieldsCell,
  TagCell,
  type CustomFieldDef,
} from "@/components/DashboardClient";
import { InfoTip } from "@/components/InfoTip";

const STAGE_STYLES: Record<JourneyStage, string> = {
  new: "bg-blue-100 text-blue-700",
  active: "bg-green-100 text-green-700",
  loyal: "bg-violet-100 text-violet-700",
  at_risk: "bg-red-100 text-red-700",
  churned: "bg-neutral-200 text-neutral-600",
};

export type Customer360Row = CustomerRow & {
  notes: string | null;
  last_contacted_at: string | null;
};

function Card({
  title,
  children,
  action,
}: {
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">{title}</h2>
        {action}
      </div>
      {children}
    </div>
  );
}

function fmtDate(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString() : "—";
}

// Digits-only for wa.me, same normalisation the campaign links use.
function waDigits(phone: string): string {
  return phone.replace(/\D/g, "");
}

export function Customer360({
  initialCustomer,
  orders,
  signupEvents,
  sends,
  campaignNames,
  journeyNames,
  rewardNames,
  rewards,
  customFieldDefs,
}: {
  initialCustomer: Customer360Row;
  orders: Order[];
  signupEvents: SignupEventRow[];
  sends: EngagementSendRow[];
  campaignNames: Record<string, string>;
  journeyNames: Record<string, string>;
  rewardNames: Record<string, string>;
  rewards: Reward[];
  customFieldDefs: CustomFieldDef[];
}) {
  const rules = useRules();
  const loyalty = useLoyalty();
  const [customer, setCustomer] = useState(initialCustomer);
  const [supabase] = useState(() => createClient());

  // --- notes ----------------------------------------------------------------
  const [notes, setNotes] = useState(customer.notes ?? "");
  const [notesState, setNotesState] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");

  async function saveNotes() {
    const next = notes.trim() || null;
    setNotesState("saving");
    const { error } = await supabase
      .from("customers")
      .update({ notes: next })
      .eq("id", customer.id);
    if (error) {
      setNotesState("error");
      return;
    }
    setCustomer((c) => ({ ...c, notes: next }));
    setNotesState("saved");
    setTimeout(() => setNotesState("idle"), 2000);
  }

  // Same optimistic editors as the dashboard table.
  async function updateTags(tags: string[]) {
    setCustomer((c) => ({ ...c, tags }));
    await supabase.from("customers").update({ tags }).eq("id", customer.id);
  }
  async function updateCustomFields(values: Record<string, unknown>) {
    setCustomer((c) => ({ ...c, custom_fields: values }));
    await supabase
      .from("customers")
      .update({ custom_fields: values })
      .eq("id", customer.id);
  }

  // --- derived --------------------------------------------------------------
  const profile = useMemo(
    () => buildProfiles([customer], orders)[0],
    [customer, orders],
  );
  const stage = stageOf(profile, rules);

  const breakdown = useMemo(
    () => loyaltyBreakdown(orders, loyalty),
    [orders, loyalty],
  );
  const shownBalance = Math.max(0, breakdown.balance);
  const progress = rewardProgress(rewards, breakdown.balance);

  const redemptions = orders.filter((o) => (o.reward_points_spent ?? 0) > 0);
  const sentMessages = sends.filter((s) => s.sent_at);

  const timeline: TimelineEvent[] = useMemo(
    () =>
      buildTimeline({
        customerCreatedAt: customer.created_at,
        signupEvents,
        orders,
        sends,
        campaignNames,
        journeyNames,
        rewardNames,
      }),
    [customer, signupEvents, orders, sends, campaignNames, journeyNames, rewardNames],
  );

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <Link
        href="/dashboard"
        className="text-sm text-neutral-500 hover:text-neutral-800"
      >
        ← Dashboard
      </Link>

      {/* Header */}
      <div className="rounded-xl border border-neutral-200 bg-white p-5 space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight">
            {customer.first_name} {customer.last_name}
          </h1>
          <span
            className={`text-xs rounded-full px-2 py-0.5 ${STAGE_STYLES[stage]}`}
          >
            {JOURNEY_LABELS[stage]}
          </span>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-neutral-600">
          <span>{customer.phone ?? "no phone"}</span>
          <span>{customer.email ?? "no email"}</span>
          <span>
            WhatsApp {customer.whatsapp_opt_in ? "✓ opted in" : "✗ not opted in"}
          </span>
          <span>
            Email {customer.email_opt_in ? "✓ opted in" : "✗ not opted in"}
          </span>
          <span>Member since {fmtDate(customer.created_at)}</span>
          {customer.birthday && <span>Birthday {fmtDate(customer.birthday)}</span>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-neutral-400">Tags:</span>
          <TagCell tags={customer.tags ?? []} onChange={updateTags} />
        </div>
        <div className="flex flex-wrap gap-2 pt-1">
          <Link
            href={`/dashboard/orders?customer=${customer.id}`}
            className="text-sm bg-neutral-900 text-white rounded-lg px-4 py-2 hover:bg-neutral-700"
          >
            Start an order
          </Link>
          {customer.phone && (
            <a
              href={`https://wa.me/${waDigits(customer.phone)}`}
              target="_blank"
              rel="noreferrer"
              className="text-sm border border-neutral-300 rounded-lg px-4 py-2 text-neutral-600 hover:border-neutral-500"
            >
              WhatsApp them
            </a>
          )}
          {customer.email && (
            <a
              href={`mailto:${customer.email}`}
              className="text-sm border border-neutral-300 rounded-lg px-4 py-2 text-neutral-600 hover:border-neutral-500"
            >
              Email them
            </a>
          )}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[3fr_2fr] items-start">
        {/* Left column */}
        <div className="space-y-6 min-w-0">
          <Card title={`Orders (${orders.length})`}>
            {orders.length === 0 ? (
              <p className="text-sm text-neutral-500">
                No orders yet — start their first one above.
              </p>
            ) : (
              <div className="overflow-x-auto -mx-4 -mb-4">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left border-y border-neutral-200 bg-neutral-50 text-neutral-500">
                      <th className="px-4 py-2 font-medium">Order</th>
                      <th className="px-4 py-2 font-medium">Items</th>
                      <th className="px-4 py-2 font-medium">Status</th>
                      <th className="px-4 py-2 font-medium">Amount</th>
                      <th className="px-4 py-2 font-medium">Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orders.map((o) => (
                      <tr
                        key={o.id}
                        className="border-b border-neutral-100 last:border-0 hover:bg-neutral-50"
                      >
                        <td className="px-4 py-2 font-medium">
                          <Link
                            href={`/dashboard/orders/${o.id}`}
                            className="hover:underline"
                          >
                            #{o.order_no}
                          </Link>
                        </td>
                        <td className="px-4 py-2 max-w-[16rem] truncate">
                          {o.order_items
                            ?.map((l) =>
                              l.quantity > 1
                                ? `${l.quantity}× ${l.item_name}`
                                : l.item_name,
                            )
                            .join(", ") || "-"}
                        </td>
                        <td className="px-4 py-2">
                          <span
                            className={`text-xs rounded-full px-2 py-0.5 capitalize ${STATUS_STYLES[o.status]}`}
                          >
                            {o.status}
                          </span>
                        </td>
                        <td className="px-4 py-2">{formatCents(o.total_cents)}</td>
                        <td className="px-4 py-2">{fmtDate(o.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {orders.length > 0 && (
              <div className="flex flex-wrap gap-x-5 gap-y-1 pt-1 text-xs text-neutral-500">
                <span>
                  Total spent{" "}
                  <strong className="text-neutral-800">
                    {formatCents(profile.totalSpentCents)}
                  </strong>
                  <InfoTip term="total_spent" align="left" />
                </span>
                <span>
                  Avg order{" "}
                  <strong className="text-neutral-800">
                    {formatCents(profile.avgOrderCents)}
                  </strong>
                </span>
                {profile.favouriteItem && (
                  <span>
                    Favourite{" "}
                    <strong className="text-neutral-800">
                      {profile.favouriteItem}
                    </strong>
                  </span>
                )}
                <span>
                  Last visit{" "}
                  <strong className="text-neutral-800">
                    {fmtDate(profile.lastVisit)}
                  </strong>
                </span>
              </div>
            )}
          </Card>

          <Card title="Activity">
            <ol className="space-y-0">
              {timeline.map((e, i) => (
                <li key={i} className="relative flex gap-3 pb-4 last:pb-0">
                  {/* rail */}
                  {i < timeline.length - 1 && (
                    <span
                      className="absolute left-[5px] top-4 bottom-0 w-px bg-neutral-200"
                      aria-hidden
                    />
                  )}
                  <span
                    className={`mt-1.5 h-[11px] w-[11px] shrink-0 rounded-full border-2 border-white ring-1 ${
                      e.kind === "order"
                        ? "bg-neutral-800 ring-neutral-300"
                        : e.kind === "message"
                          ? "bg-blue-400 ring-blue-200"
                          : "bg-green-500 ring-green-200"
                    }`}
                    aria-hidden
                  />
                  <div className="min-w-0 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      {e.href ? (
                        <Link href={e.href} className="font-medium hover:underline">
                          {e.label}
                        </Link>
                      ) : (
                        <span className="font-medium">{e.label}</span>
                      )}
                      {e.status && (
                        <span
                          className={`text-[11px] rounded-full px-1.5 py-0.5 capitalize ${STATUS_STYLES[e.status]}`}
                        >
                          {e.status}
                        </span>
                      )}
                      <span className="text-xs text-neutral-400">
                        {new Date(e.at).toLocaleString()}
                      </span>
                    </div>
                    {e.detail && (
                      <p className="text-xs text-neutral-500 mt-0.5">{e.detail}</p>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          </Card>
        </div>

        {/* Right column */}
        <div className="space-y-6 min-w-0">
          <Card title="Loyalty">
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-bold tracking-tight">
                {shownBalance}
              </span>
              <span className="text-sm text-neutral-500">
                points
                <InfoTip term="points_balance" align="left" />
              </span>
            </div>
            <dl className="text-xs text-neutral-500 space-y-1">
              {breakdown.fromOrders > 0 && (
                <div className="flex justify-between">
                  <dt>
                    {breakdown.completedOrders} completed order
                    {breakdown.completedOrders === 1 ? "" : "s"}
                  </dt>
                  <dd className="text-neutral-800">+{breakdown.fromOrders}</dd>
                </div>
              )}
              {breakdown.fromSpend > 0 && (
                <div className="flex justify-between">
                  <dt>{formatCents(breakdown.completedSpendCents)} spent</dt>
                  <dd className="text-neutral-800">+{breakdown.fromSpend}</dd>
                </div>
              )}
              {breakdown.fromBonus > 0 && (
                <div className="flex justify-between">
                  <dt>Welcome bonus</dt>
                  <dd className="text-neutral-800">+{breakdown.fromBonus}</dd>
                </div>
              )}
              {breakdown.spent > 0 && (
                <div className="flex justify-between">
                  <dt>Redeemed on rewards</dt>
                  <dd className="text-neutral-800">−{breakdown.spent}</dd>
                </div>
              )}
            </dl>
            <p className="text-[11px] text-neutral-400">
              Earning: {earningRuleText(loyalty)}.
            </p>
            <div className="border-t border-neutral-100 pt-2 text-xs text-neutral-600">
              {progress.redeemableNow ? (
                <p>
                  Can redeem <strong>{progress.redeemableNow.name}</strong> (
                  {progress.redeemableNow.points_cost} pts) today — at the order
                  pad.
                </p>
              ) : progress.next ? (
                <p>
                  {progress.next.needed} more point
                  {progress.next.needed === 1 ? "" : "s"} to{" "}
                  <strong>{progress.next.reward.name}</strong> (
                  {progress.next.reward.points_cost} pts).
                </p>
              ) : (
                <p className="text-neutral-400">No active rewards set up yet.</p>
              )}
            </div>
            {redemptions.length > 0 && (
              <div className="border-t border-neutral-100 pt-2">
                <p className="text-xs text-neutral-400 mb-1">Redemptions</p>
                <ul className="text-xs text-neutral-600 space-y-1">
                  {redemptions.map((o) => (
                    <li key={o.id} className="flex justify-between gap-2">
                      <span className="truncate">
                        {(o.reward_id && rewardNames[o.reward_id]) ?? "Reward"} ·{" "}
                        <Link
                          href={`/dashboard/orders/${o.id}`}
                          className="hover:underline"
                        >
                          #{o.order_no}
                        </Link>
                        {o.status === "cancelled" && " (cancelled — refunded)"}
                      </span>
                      <span className="shrink-0">
                        −{o.reward_points_spent} pts
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Card>

          <Card title="Engagement">
            <dl className="text-sm space-y-1.5">
              <div className="flex justify-between">
                <dt className="text-neutral-500">Messages received</dt>
                <dd>{sentMessages.length}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-neutral-500">Last contacted</dt>
                <dd>{fmtDate(customer.last_contacted_at)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-neutral-500">
                  Reachable
                  <InfoTip term="reachable" align="left" />
                </dt>
                <dd>
                  {customer.whatsapp_opt_in || customer.email_opt_in
                    ? "Yes"
                    : "No — no marketing"}
                </dd>
              </div>
            </dl>
          </Card>

          {customFieldDefs.length > 0 && (
            <Card title="Custom fields">
              <CustomFieldsCell
                defs={customFieldDefs}
                values={customer.custom_fields ?? {}}
                onChange={updateCustomFields}
              />
            </Card>
          )}

          <Card
            title="Notes"
            action={
              <button
                onClick={saveNotes}
                disabled={
                  notesState === "saving" ||
                  (notes.trim() || null) === (customer.notes ?? null)
                }
                className="text-xs bg-neutral-900 text-white rounded px-2.5 py-1 disabled:opacity-40"
              >
                {notesState === "saving"
                  ? "Saving…"
                  : notesState === "saved"
                    ? "Saved ✓"
                    : "Save"}
              </button>
            }
          >
            <textarea
              value={notes}
              onChange={(e) => {
                setNotes(e.target.value);
                if (notesState === "saved" || notesState === "error")
                  setNotesState("idle");
              }}
              rows={4}
              placeholder="Allergies, preferences, anything staff should know…"
              className="w-full border border-neutral-300 rounded px-2 py-1.5 text-sm"
            />
            {notesState === "error" && (
              <p className="text-xs text-red-600">Could not save — try again.</p>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
