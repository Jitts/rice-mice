"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { buildProfiles, type CustomerRow } from "@/lib/segments";
import { buildSuggestions, type Suggestion } from "@/lib/suggestions";
import { useRules } from "@/components/RulesContext";
import type { Order } from "@/lib/orders";

export type SegmentStub = { id: string; name: string };

export function SuggestedActions({
  customers,
  orders,
  segments,
}: {
  customers: CustomerRow[];
  orders: Order[];
  segments: SegmentStub[];
}) {
  const router = useRouter();
  const rules = useRules();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const suggestions = useMemo(
    () => buildSuggestions(buildProfiles(customers, orders), rules),
    [customers, orders, rules],
  );

  // Reuse the auto segment by name if it exists (refreshing its definition —
  // e.g. the birthday month rolls over), otherwise create it. Then hand off to
  // the composer, where the human drives everything.
  async function start(s: Suggestion) {
    setBusyId(s.id);
    setError(null);
    const supabase = createClient();
    const existing = segments.find((seg) => seg.name === s.segmentName);
    let segmentId = existing?.id;
    if (segmentId) {
      const { error: uErr } = await supabase
        .from("segments")
        .update({ definition: s.definition, updated_at: new Date().toISOString() })
        .eq("id", segmentId);
      if (uErr) {
        setBusyId(null);
        setError("Couldn't prepare the segment — try again.");
        return;
      }
    } else {
      segmentId = crypto.randomUUID();
      const { error: iErr } = await supabase
        .from("segments")
        .insert({ id: segmentId, name: s.segmentName, definition: s.definition });
      if (iErr) {
        setBusyId(null);
        setError("Couldn't prepare the segment — try again.");
        return;
      }
    }
    router.push(`/dashboard/campaigns/new?segment=${segmentId}`);
  }

  if (suggestions.length === 0) return null;

  return (
    <section>
      <h2 className="text-lg font-semibold mb-3">Suggested actions</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {suggestions.map((s) => (
          <div
            key={s.id}
            className="rounded-xl border border-border bg-card p-4 flex flex-col"
          >
            <p className="text-sm font-semibold">{s.title}</p>
            <p className="text-sm text-muted-foreground mt-1 flex-1">{s.detail}</p>
            <div className="flex items-center justify-between mt-3">
              <span className="text-xs text-muted-foreground/70">
                {s.reachableCount} of {s.count} reachable
              </span>
              <button
                onClick={() => start(s)}
                disabled={busyId !== null || s.reachableCount === 0}
                title={
                  s.reachableCount === 0
                    ? "No one in this group has opted in to marketing"
                    : undefined
                }
                className="text-sm bg-primary text-primary-foreground rounded-lg px-3 py-1.5 disabled:opacity-40"
              >
                {busyId === s.id ? "Preparing…" : "Start campaign"}
              </button>
            </div>
          </div>
        ))}
      </div>
      {error && <p className="text-destructive text-sm mt-2">{error}</p>}
      <p className="text-[11px] text-muted-foreground/70 mt-2">
        Starting a campaign only prepares the audience and opens the composer —
        you review and approve everything before a single message exists.
      </p>
    </section>
  );
}
