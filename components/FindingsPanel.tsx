"use client";

import Link from "next/link";
import type { Finding, FindingTone } from "@/lib/findings";

// The "Notable findings" cards at the top of Reports. Purely presentational:
// every number was computed server-side by lib/findings.ts. "Ask why" hands
// the finding to the analyst chat lower on the page.

const TONE_STYLES: Record<FindingTone, { border: string; badge: string; label: string }> = {
  warn: { border: "border-l-amber-400", badge: "bg-amber-100 text-amber-700", label: "Worth a look" },
  good: { border: "border-l-emerald-400", badge: "bg-emerald-100 text-emerald-700", label: "Going well" },
  info: { border: "border-l-sky-300", badge: "bg-sky-100 text-sky-700", label: "Heads up" },
};

export function FindingsPanel({
  findings,
  onAsk,
}: {
  findings: Finding[];
  onAsk: (finding: Finding) => void;
}) {
  return (
    <section>
      <h2 className="text-sm font-semibold mb-2">Notable findings</h2>
      {findings.length === 0 ? (
        <div className="rounded-xl border border-neutral-200 bg-white p-4 text-sm text-neutral-400">
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
                className={`rounded-xl border border-neutral-200 border-l-4 ${tone.border} bg-white p-4 flex flex-col gap-2`}
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="font-semibold text-sm leading-snug">{f.title}</p>
                  <span
                    className={`shrink-0 text-[11px] font-medium rounded-full px-2 py-0.5 ${tone.badge}`}
                  >
                    {tone.label}
                  </span>
                </div>
                <p className="text-sm text-neutral-600">{f.body}</p>
                {f.receipts.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {f.receipts.map((r, i) => {
                      const chip = (
                        <span className="inline-flex items-center gap-1 rounded-full border border-neutral-200 bg-neutral-50 px-2 py-0.5 text-xs">
                          <span className="text-neutral-500">{r.label}</span>
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
                <div className="mt-auto flex items-center justify-between pt-1">
                  {f.action ? (
                    <Link
                      href={f.action.href}
                      className="text-xs font-medium text-neutral-700 underline underline-offset-2 hover:text-neutral-900"
                    >
                      {f.action.label}
                    </Link>
                  ) : (
                    <span />
                  )}
                  <button
                    onClick={() => onAsk(f)}
                    className="text-xs font-medium text-violet-700 hover:text-violet-900"
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
