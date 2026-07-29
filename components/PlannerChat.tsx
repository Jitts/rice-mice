"use client";

import { useRef, useState, useTransition } from "react";
import { planWithAssistant, type PlannerTurn } from "@/app/actions/planner";
import type { PlannerMode, PlannerPlan } from "@/lib/plannerAgent";

// The planner panel on Segments and Campaigns. It shows a PROPOSAL — what the
// plan does, step by step, plus what to think about before running it — and
// nothing happens until the user presses Apply. The concerns list is deliberately
// not collapsible: it's the part most worth reading and the easiest to skip.

export function PlannerChat({
  mode,
  ready,
  keyName,
  matchCount,
  onApply,
}: {
  mode: PlannerMode;
  ready: boolean;
  keyName: string;
  // Live count for the currently proposed audience, computed by the parent with
  // the same engine the builder preview uses — so the number here can never
  // disagree with what the builder shows after Apply.
  matchCount: (plan: PlannerPlan) => { matched: number; reachable: number };
  onApply: (plan: PlannerPlan) => void;
}) {
  const [history, setHistory] = useState<PlannerTurn[]>([]);
  const [plan, setPlan] = useState<PlannerPlan | null>(null);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [applied, setApplied] = useState(false);
  const [busy, startTransition] = useTransition();
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const isCampaign = mode === "campaign";
  const examples = isCampaign
    ? '"Create a win-back campaign for regulars who haven\'t been in for a month"'
    : '"Everyone who\'s spent over $100 but hasn\'t visited in 6 weeks"';

  function send() {
    const request = input.trim();
    if (!request || busy) return;
    const priorTurns = history;
    setError(null);
    setApplied(false);
    startTransition(async () => {
      const result = await planWithAssistant(mode, request, priorTurns);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setPlan(result.plan);
      setInput("");
      // Feed the accepted plan back as context so "make it wider" works.
      setHistory([
        ...priorTurns,
        { role: "user", content: request },
        { role: "assistant", content: JSON.stringify(result.plan) },
      ]);
    });
  }

  if (!ready) {
    return (
      <section className="rounded-xl border border-border bg-card p-4">
        <h2 className="text-sm font-semibold mb-1">Ask the assistant</h2>
        <p className="text-sm text-muted-foreground">
          Not connected yet. Add{" "}
          <code className="text-xs bg-muted rounded px-1">{keyName}</code> to the
          server environment and redeploy to switch it on. The builder below works
          without it.
        </p>
      </section>
    );
  }

  const counts = plan ? matchCount(plan) : null;

  return (
    <section className="rounded-xl border border-border bg-card">
      <div className="px-4 pt-4 pb-2 flex items-baseline justify-between flex-wrap gap-1">
        <h2 className="text-sm font-semibold">
          Ask the assistant to build {isCampaign ? "a campaign" : "a segment"}
        </h2>
        <p className="text-xs text-muted-foreground/70">
          It proposes — nothing is saved until you apply it.
        </p>
      </div>

      <div className="px-3 pb-3 flex gap-2 items-end">
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          rows={2}
          maxLength={600}
          placeholder={`Try ${examples}`}
          className="flex-1 resize-none text-sm border border-input rounded-lg px-3 py-2 focus:outline-none focus:border-ring"
        />
        <button
          onClick={send}
          disabled={busy || !input.trim()}
          className="text-sm bg-primary text-primary-foreground rounded-lg px-4 py-2 disabled:opacity-40"
        >
          {busy ? "…" : plan ? "Redo" : "Plan it"}
        </button>
      </div>

      {busy && (
        <p className="px-4 pb-3 text-sm text-muted-foreground/70 animate-pulse">
          Working out who this should reach…
        </p>
      )}
      {error && <p className="px-4 pb-3 text-sm text-destructive">{error}</p>}

      {plan && !busy && (
        <div className="border-t border-border/60 px-4 py-3 space-y-3">
          <div className="flex items-baseline justify-between gap-2 flex-wrap">
            <h3 className="text-sm font-medium">{plan.name}</h3>
            {counts && (
              <span className="text-xs text-muted-foreground">
                {counts.matched} match{counts.matched === 1 ? "" : "es"} ·{" "}
                {counts.reachable} reachable
              </span>
            )}
          </div>

          {plan.explanation && (
            <p className="text-sm text-muted-foreground">{plan.explanation}</p>
          )}

          {plan.steps.length > 0 && (
            <ol className="text-sm text-foreground/80 space-y-1 list-decimal pl-5">
              {plan.steps.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ol>
          )}

          {isCampaign && plan.body && (
            <div className="rounded-lg bg-muted/60 p-3 space-y-1">
              <p className="text-xs text-muted-foreground">
                {plan.channel} draft
                {plan.subject ? ` · subject: ${plan.subject}` : ""}
              </p>
              <p className="text-sm whitespace-pre-wrap">{plan.body}</p>
            </div>
          )}

          <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 p-3">
            <p className="text-xs font-medium text-amber-800 dark:text-amber-200 mb-1">
              Worth thinking about
            </p>
            <ul className="text-sm text-amber-800 dark:text-amber-200 space-y-1 list-disc pl-5">
              {plan.concerns.map((c, i) => (
                <li key={i}>{c}</li>
              ))}
            </ul>
          </div>

          {counts?.matched === 0 && (
            <p className="text-sm text-muted-foreground">
              This matches nobody right now — apply it anyway to adjust the
              conditions by hand, or ask for something wider.
            </p>
          )}

          <div className="flex items-center gap-3">
            <button
              onClick={() => {
                onApply(plan);
                setApplied(true);
              }}
              className="text-sm bg-primary text-primary-foreground rounded-lg px-4 py-2"
            >
              Apply to the builder
            </button>
            {applied && (
              <span className="text-sm text-emerald-600 dark:text-emerald-400">
                Applied — review and save below.
              </span>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
