"use client";

import Link from "next/link";
import type { Finding, FindingTone } from "@/lib/findings";
import { AgenticProposalPanel } from "@/components/AgenticProposalPanel";

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
}: {
  findings: Finding[];
  onAsk: (finding: Finding) => void;
  canApplyTags: boolean;
}) {
  return (
    <section>
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
                    <Link
                      href={f.action.href}
                      className="text-xs font-medium text-foreground/80 underline underline-offset-2 hover:text-foreground"
                    >
                      {f.action.label}
                    </Link>
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
