"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { sendJourneyEmail } from "@/app/actions/email";
import { sendLink, type CampaignChannel } from "@/lib/campaigns";
import { runJourneyTick } from "@/lib/journeyExecutor";
import { InfoTip } from "@/components/InfoTip";
import { useStaff } from "@/components/StaffContext";
import type { MessagePayload } from "@/lib/journeys";

export type InboxAction = {
  id: string;
  created_at: string;
  customer_id: string;
  journey_id: string;
  payload: MessagePayload;
  status: string;
  customers: {
    first_name: string;
    last_name: string;
    phone: string | null;
    email: string | null;
    whatsapp_opt_in: boolean;
    email_opt_in: boolean;
  } | null;
};

// Consent re-checked at send time — an unsubscribe after the draft was
// prepared makes the send button disappear.
function liveAddress(a: InboxAction): string | null {
  const c = a.customers;
  if (!c) return null;
  if (a.payload.channel === "whatsapp")
    return c.whatsapp_opt_in && c.phone ? c.phone : null;
  return c.email_opt_in && c.email ? c.email : null;
}

export function ActionInbox({
  initialActions,
  emailReady,
}: {
  initialActions: InboxAction[];
  emailReady: boolean;
}) {
  const [supabase] = useState(() => createClient());
  const staff = useStaff();
  const [actions, setActions] = useState<InboxAction[]>(initialActions);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [sendErrors, setSendErrors] = useState<Record<string, string>>({});

  // Provider path: the server action sends the draft, resolves the action,
  // and writes the engagement log — the client just mirrors the result.
  async function sendViaProvider(a: InboxAction) {
    if (busyId) return;
    setBusyId(a.id);
    const res = await sendJourneyEmail(a.id);
    setBusyId(null);
    if (!res.ok) {
      setSendErrors((e) => ({ ...e, [a.id]: res.error }));
      return;
    }
    setActions((list) => list.filter((x) => x.id !== a.id));
  }

  // Tick on load: advance due runs, then pull anything newly prepared.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { actionsCreated } = await runJourneyTick(supabase);
        if (cancelled || actionsCreated === 0) return;
        const { data } = await supabase
          .from("journey_actions")
          .select(
            "id, created_at, customer_id, journey_id, payload, status, customers(first_name, last_name, phone, email, whatsapp_opt_in, email_opt_in)",
          )
          .eq("status", "pending")
          .order("created_at", { ascending: false });
        if (!cancelled && data) setActions(data as unknown as InboxAction[]);
      } catch {
        // tick failures never block the dashboard
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  async function resolve(a: InboxAction, status: "done" | "skipped") {
    setActions((list) => list.filter((x) => x.id !== a.id));
    await supabase
      .from("journey_actions")
      .update({ status, acted_at: new Date().toISOString() })
      .eq("id", a.id);
    if (status === "done") {
      // The send lands in the same message history as campaign sends, and
      // stamped with journey_id so it counts in the journey's own results
      // (the same attribution engine one-time campaigns use).
      await supabase.from("engagement_logs").insert({
        customer_id: a.customer_id,
        journey_id: a.journey_id,
        channel: a.payload.channel,
        message_draft: a.payload.body,
        message_draft_source: "journey",
        message_draft_review_status: "approved",
        sent_at: new Date().toISOString(),
        sent_via: "manual",
        sent_by: staff?.display_name ?? null,
      });
      await supabase
        .from("customers")
        .update({ last_contacted_at: new Date().toISOString() })
        .eq("id", a.customer_id);
    }
  }

  if (actions.length === 0) return null;

  return (
    <section>
      <h2 className="text-lg font-semibold mb-3">
        Action inbox
        <span className="ml-2 text-xs bg-red-100 text-red-700 rounded-full px-2 py-0.5 align-middle">
          {actions.length}
        </span>
        <InfoTip term="action_inbox" align="left" />
      </h2>
      <div className="rounded-xl border border-neutral-200 bg-white divide-y">
        {actions.map((a) => {
          const c = a.customers;
          const addr = liveAddress(a);
          const link = addr
            ? sendLink(a.payload.channel as CampaignChannel, addr, null, a.payload.body)
            : null;
          const isOpen = expanded === a.id;
          return (
            <div key={a.id} className="px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <button
                  onClick={() => setExpanded(isOpen ? null : a.id)}
                  className="text-left text-sm flex-1 min-w-0"
                >
                  <span className="font-medium">{a.payload.journey_name}</span>{" "}
                  <span className="text-neutral-500">
                    prepared a {a.payload.channel === "email" ? "email" : "WhatsApp"} draft
                    for {c ? `${c.first_name} ${c.last_name}` : "a deleted customer"}
                  </span>
                </button>
                <div className="flex items-center gap-2 whitespace-nowrap">
                  {addr && emailReady && a.payload.channel === "email" ? (
                    <>
                      {link && (
                        <a
                          href={link}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={() => resolve(a, "done")}
                          className="text-xs text-neutral-400 underline"
                          title="Fallback: open in your mail app and mark sent"
                        >
                          mail app
                        </a>
                      )}
                      <button
                        onClick={() => sendViaProvider(a)}
                        disabled={busyId !== null}
                        className="text-sm bg-neutral-900 text-white rounded px-3 py-1.5 disabled:opacity-50"
                      >
                        {busyId === a.id ? "Sending…" : "Send email"}
                      </button>
                    </>
                  ) : link ? (
                    <a
                      href={link}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={() => resolve(a, "done")}
                      className="text-sm bg-neutral-900 text-white rounded px-3 py-1.5"
                    >
                      Review &amp; send
                    </a>
                  ) : (
                    <span className="text-xs text-neutral-400">
                      Unsubscribed since — can&apos;t send
                    </span>
                  )}
                  <button
                    onClick={() => resolve(a, "skipped")}
                    className="text-sm border border-neutral-300 rounded px-3 py-1.5 text-neutral-500"
                  >
                    Skip
                  </button>
                </div>
              </div>
              {sendErrors[a.id] && (
                <p className="text-xs text-red-600 mt-1">{sendErrors[a.id]}</p>
              )}
              {isOpen && (
                <p className="text-xs text-neutral-500 whitespace-pre-wrap mt-2 border-t pt-2">
                  {a.payload.body}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
