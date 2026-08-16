"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Finding, FindingTone } from "@/lib/findings";
import { AgenticProposalPanel } from "@/components/AgenticProposalPanel";
import { CreateSegmentDialog } from "@/components/CreateSegmentDialog";
import { CAMPAIGN_HANDOFF_KEY, type CampaignHandoff } from "@/lib/plannerAgent";
import type { Suggestion } from "@/lib/suggestions";
import type {
  CustomFieldRow,
  CustomerProfile,
  SegmentDefinition,
} from "@/lib/segments";

// The "Notable findings" cards at the top of Reports. Purely presentational:
// every number was computed server-side by lib/findings.ts. "Ask why" hands
// the finding to the analyst chat lower on the page.

const TONE_STYLES: Record<FindingTone, { border: string; badge: string; label: string }> = {
  warn: { border: "border-l-amber-400", badge: "bg-amber-100 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300", label: "Worth a look" },
  good: { border: "border-l-emerald-400", badge: "bg-emerald-100 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300", label: "Going well" },
  info: { border: "border-l-sky-300", badge: "bg-sky-100 dark:bg-sky-950/50 text-sky-700 dark:text-sky-300", label: "Heads up" },
};

export function FindingsPanel({
  findings,
  onAsk,
  canApplyTags,
  suggestions,
  profiles,
  customFields,
  segments,
}: {
  findings: Finding[];
  onAsk: (finding: Finding) => void;
  canApplyTags: boolean;
  suggestions: Suggestion[];
  profiles: CustomerProfile[];
  customFields: CustomFieldRow[];
  segments: { id: string; name: string; definition: SegmentDefinition | null }[];
}) {
  const router = useRouter();
  // The suggestion a finding's button asked to build, or null when closed.
  const [pending, setPending] = useState<Suggestion | null>(null);

  const suggestionFor = (f: Finding): Suggestion | null =>
    suggestions.find((s) => s.id === f.action?.suggestion) ?? null;

  // Saved, so now hand the composer the rest of the campaign. The segment
  // travels in the URL because the composer already reads ?segment=; the copy
  // rides sessionStorage on the same key the assistant plan uses, which the
  // composer reads and clears on mount.
  function handOff(suggestion: Suggestion, segmentId: string, segmentName: string) {
    const handoff: CampaignHandoff = {
      segmentId,
      // WhatsApp is the shop's front door and the only channel that always has
      // a manual path, so it can never open on a channel that cannot send.
      channel: "whatsapp",
      name: `${segmentName} — ${new Date().toLocaleDateString()}`,
      subject: null,
      body: suggestion.campaignBody,
    };
    try {
      sessionStorage.setItem(CAMPAIGN_HANDOFF_KEY, JSON.stringify(handoff));
    } catch {
      // A private-mode or quota failure costs the draft copy, not the audience —
      // the segment is already saved and travels in the URL. Go anyway.
    }
    router.push(`/dashboard/campaigns/new?segment=${segmentId}`);
  }
  return (
    <section>
      {pending && (
        <CreateSegmentDialog
          open
          onClose={() => setPending(null)}
          onSaved={(seg) => {
            const s = pending;
            setPending(null);
            handOff(s, seg.id, seg.name);
          }}
          profiles={profiles}
          customFields={customFields}
          segments={segments}
          initialName={pending.segmentName}
          initialDefinition={pending.definition}
          saving="Save and write the campaign"
        />
      )}
      <h2 className="text-sm font-semibold mb-2">Notable findings</h2>
      {findings.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground/70">
          Nothing notable right now — the numbers look steady. Findings appear
          here when revenue shifts, regulars go quiet, or a campaign stands out.
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {findings.map((f) => {
            const tone = TONE_STYLES[f.tone];
            return (
              <div
                key={f.id}
                className={`rounded-xl border border-border border-l-4 ${tone.border} bg-card p-4 flex flex-col gap-2`}
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="font-semibold text-sm leading-snug">{f.title}</p>
                  <span
                    className={`shrink-0 text-[11px] font-medium rounded-full px-2 py-0.5 ${tone.badge}`}
                  >
                    {tone.label}
                  </span>
                </div>
                <p className="text-sm text-muted-foreground">{f.body}</p>
                {f.receipts.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {f.receipts.map((r, i) => {
                      const chip = (
                        <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2 py-0.5 text-xs">
                          <span className="text-muted-foreground">{r.label}</span>
                          <span className="font-medium">{r.value}</span>
                        </span>
                      );
                      return r.href ? (
                        <Link key={i} href={r.href} className="hover:opacity-70">
                          {chip}
                        </Link>
                      ) : (
                        <span key={i}>{chip}</span>
                      );
                    })}
                  </div>
                )}
                {f.proposal && (
                  <AgenticProposalPanel
                    proposal={f.proposal}
                    source={`finding:${f.id}`}
                    canApply={canApplyTags}
                  />
                )}
                <div className="mt-auto flex items-center justify-between pt-1">
                  {f.action ? (
                    // A suggestion id only becomes a button if that suggestion
                    // is actually present this render — the cohort can empty
                    // out between builds, and a dialog with no criteria is a
                    // worse answer than the link it replaced.
                    suggestionFor(f) ? (
                      <button
                        type="button"
                        onClick={() => setPending(suggestionFor(f)!)}
                        className="text-xs font-medium text-foreground/80 underline underline-offset-2 hover:text-foreground"
                      >
                        {f.action.label}
                      </button>
                    ) : (
                      <Link
                        href={f.action.href}
                        className="text-xs font-medium text-foreground/80 underline underline-offset-2 hover:text-foreground"
                      >
                        {f.action.label}
                      </Link>
                    )
                  ) : (
                    <span />
                  )}
                  <button
                    onClick={() => onAsk(f)}
                    className="text-xs font-medium text-violet-700 dark:text-violet-300 hover:text-violet-900 dark:hover:text-violet-100"
                  >
                    Ask why →
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
