"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  CHANNELS,
  composeMessage,
  type CampaignChannel,
} from "@/lib/campaigns";
import {
  buildFieldRegistry,
  buildProfiles,
  filterProfiles,
  EMPTY_DEFINITION,
  type CustomFieldRow,
  type CustomerRow,
  type SegmentDefinition,
} from "@/lib/segments";
import type { Order } from "@/lib/orders";
import type { SavedSegment } from "@/components/SegmentsManager";

const DEFAULT_BODY =
  "Hi {{name}}! We've got something special for you at rice-mice this week — come say hi 🍚🐭";

export function CampaignComposer({
  initialCustomers,
  initialOrders,
  segments,
  initialSegmentId,
  initialCustomFields,
}: {
  initialCustomers: CustomerRow[];
  initialOrders: Order[];
  segments: SavedSegment[];
  initialSegmentId?: string;
  initialCustomFields: CustomFieldRow[];
}) {
  const router = useRouter();
  const [supabase] = useState(() => createClient());

  const [segmentId, setSegmentId] = useState<string>(
    initialSegmentId && segments.some((s) => s.id === initialSegmentId)
      ? initialSegmentId
      : (segments[0]?.id ?? ""),
  );
  const [channel, setChannel] = useState<CampaignChannel>("whatsapp");
  const [name, setName] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState(DEFAULT_BODY);
  const [step, setStep] = useState<"compose" | "review">("compose");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const profiles = useMemo(
    () => buildProfiles(initialCustomers, initialOrders),
    [initialCustomers, initialOrders],
  );
  const fieldRegistry = useMemo(() => buildFieldRegistry(initialCustomFields), [initialCustomFields]);
  // A segment referenced by another (merge/exclude) needs every saved segment's
  // definition available to resolve against, not just the one being sent.
  const segmentsById = useMemo(
    () => Object.fromEntries(segments.map((s) => [s.id, s.definition ?? EMPTY_DEFINITION])),
    [segments],
  );

  const segment = segments.find((s) => s.id === segmentId) ?? null;
  const definition: SegmentDefinition = segment?.definition ?? EMPTY_DEFINITION;

  const matched = useMemo(
    () => filterProfiles(definition, profiles, fieldRegistry.byId, segmentsById),
    [definition, profiles, fieldRegistry, segmentsById],
  );

  // Per-channel recipient resolution. The channel's address() enforces consent +
  // contact info, so "recipients" is exactly who may legally receive this.
  const channelCounts = useMemo(() => {
    const counts = new Map<CampaignChannel, number>();
    for (const ch of CHANNELS) {
      counts.set(ch.id, matched.filter((p) => ch.address(p) !== null).length);
    }
    return counts;
  }, [matched]);

  const activeChannel = CHANNELS.find((c) => c.id === channel)!;
  const recipients = useMemo(
    () => matched.filter((p) => activeChannel.address(p) !== null),
    [matched, activeChannel],
  );
  const excluded = matched.length - recipients.length;

  const previewProfile = recipients[0] ?? null;
  const campaignName =
    name.trim() ||
    `${segment?.name ?? "Segment"} — ${new Date().toLocaleDateString()}`;

  const canContinue =
    !!segment && recipients.length > 0 && body.trim().length > 0 &&
    (channel !== "email" || subject.trim().length > 0);

  async function approve() {
    if (!segment || recipients.length === 0) return;
    setBusy(true);
    setError(null);

    const campaignId = crypto.randomUUID();
    const { error: cErr } = await supabase.from("campaigns").insert({
      id: campaignId,
      name: campaignName,
      segment_id: segment.id,
      segment_name: segment.name,
      definition: segment.definition,
      channel,
      subject: channel === "email" ? subject.trim() : null,
      body: body.trim(),
      recipient_count: recipients.length,
    });
    if (cErr) {
      setBusy(false);
      setError("Couldn't create the campaign — try again.");
      return;
    }

    const rows = recipients.map((p) => ({
      campaign_id: campaignId,
      customer_id: p.id,
      channel,
      message_draft: composeMessage(body.trim(), p),
      message_draft_source: "template",
      message_draft_review_status: "approved",
    }));
    const { error: lErr } = await supabase.from("engagement_logs").insert(rows);
    if (lErr) {
      // Don't leave a recipient-less campaign behind.
      await supabase.from("campaigns").delete().eq("id", campaignId);
      setBusy(false);
      setError("Couldn't create the send run — try again.");
      return;
    }

    router.push(`/dashboard/campaigns/${campaignId}`);
  }

  if (segments.length === 0) {
    return (
      <main className="min-h-screen p-8 max-w-3xl mx-auto space-y-4">
        <h1 className="text-2xl font-bold">New campaign</h1>
        <p className="text-neutral-500">
          Campaigns are sent to a saved segment, and there are none yet.{" "}
          <Link href="/dashboard/segments" className="underline">
            Build a segment first.
          </Link>
        </p>
      </main>
    );
  }

  return (
    <main className="min-h-screen p-8 max-w-3xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">New campaign</h1>
        <nav className="flex gap-4 text-sm text-neutral-500">
          <Link href="/dashboard/campaigns" className="underline">Campaigns</Link>
          <Link href="/dashboard/segments" className="underline">Segments</Link>
          <Link href="/dashboard" className="underline">Dashboard</Link>
        </nav>
      </div>

      {step === "compose" ? (
        <>
          <div className="space-y-4">
            <div>
              <label className="block text-xs uppercase tracking-wide text-neutral-400 mb-1">
                Audience
              </label>
              <select
                value={segmentId}
                onChange={(e) => setSegmentId(e.target.value)}
                className="w-full border border-neutral-300 rounded px-3 py-2"
              >
                {segments.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs uppercase tracking-wide text-neutral-400 mb-1">
                Channel
              </label>
              <div className="flex flex-wrap gap-2">
                {CHANNELS.map((ch) => {
                  const count = channelCounts.get(ch.id) ?? 0;
                  const selected = channel === ch.id;
                  return (
                    <button
                      key={ch.id}
                      type="button"
                      disabled={!ch.available}
                      onClick={() => setChannel(ch.id)}
                      title={ch.hint}
                      className={`text-sm rounded-full px-4 py-1.5 border ${
                        selected
                          ? "border-neutral-900 bg-neutral-900 text-white"
                          : ch.available
                            ? "border-neutral-300 bg-white text-neutral-700"
                            : "border-neutral-200 bg-neutral-50 text-neutral-400"
                      }`}
                    >
                      {ch.label}
                      {ch.available ? ` · ${count}` : " · not connected"}
                    </button>
                  );
                })}
              </div>
              <p className="text-xs text-neutral-400 mt-1">{activeChannel.hint}.</p>
            </div>

            <div>
              <label className="block text-xs uppercase tracking-wide text-neutral-400 mb-1">
                Campaign name
              </label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={campaignName}
                className="w-full border border-neutral-300 rounded px-3 py-2"
              />
            </div>

            {channel === "email" && (
              <div>
                <label className="block text-xs uppercase tracking-wide text-neutral-400 mb-1">
                  Subject
                </label>
                <input
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="A treat from rice-mice"
                  className="w-full border border-neutral-300 rounded px-3 py-2"
                />
              </div>
            )}

            <div>
              <label className="block text-xs uppercase tracking-wide text-neutral-400 mb-1">
                Message — <code className="text-neutral-500">{"{{name}}"}</code> becomes
                the customer&apos;s first name
              </label>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={4}
                className="w-full border border-neutral-300 rounded px-3 py-2"
              />
            </div>

            {previewProfile && (
              <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-3">
                <p className="text-xs text-neutral-400 mb-1">
                  Preview for {previewProfile.firstName}:
                </p>
                <p className="text-sm whitespace-pre-wrap">
                  {composeMessage(body, previewProfile)}
                </p>
              </div>
            )}
          </div>

          <div className="rounded-lg border border-neutral-200 bg-white p-4 flex items-center justify-between">
            <div className="text-sm text-neutral-600">
              <span className="text-xl font-semibold text-neutral-900">
                {recipients.length}
              </span>{" "}
              will receive this
              {excluded > 0 && (
                <span className="text-neutral-400">
                  {" "}
                  · {excluded} matched but excluded (no consent or contact info)
                </span>
              )}
            </div>
            <button
              onClick={() => setStep("review")}
              disabled={!canContinue}
              className="text-sm bg-neutral-900 text-white rounded px-4 py-2 disabled:opacity-40"
            >
              Review send run
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
            You&apos;re about to create a send run of{" "}
            <strong>{recipients.length}</strong> {activeChannel.label} messages for
            “{campaignName}”. Nothing is sent automatically — on the next screen each
            message opens in {channel === "email" ? "your mail app" : "WhatsApp"} and
            you press send yourself.
          </div>

          <div className="rounded-lg border border-neutral-200 bg-white divide-y max-h-96 overflow-y-auto">
            {recipients.map((p) => (
              <div key={p.id} className="px-4 py-2 flex items-center justify-between text-sm">
                <span>
                  {p.firstName} {p.lastName}
                </span>
                <span className="text-neutral-400">{activeChannel.address(p)}</span>
              </div>
            ))}
          </div>

          {error && <p className="text-red-600 text-sm">{error}</p>}

          <div className="flex items-center justify-between">
            <button
              onClick={() => setStep("compose")}
              className="text-sm border border-neutral-300 rounded px-4 py-2"
            >
              ← Back to editing
            </button>
            <button
              onClick={approve}
              disabled={busy}
              className="text-sm bg-neutral-900 text-white rounded px-4 py-2 disabled:opacity-50"
            >
              {busy ? "Creating…" : `Approve & create send run (${recipients.length})`}
            </button>
          </div>
        </>
      )}
    </main>
  );
}
