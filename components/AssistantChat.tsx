"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { askAnalyst } from "@/app/actions/analyst";
import { planWithAssistant } from "@/app/actions/planner";
import {
  clearThread,
  loadThread,
  saveThread,
  threadHistory,
  type AssistantExchange,
} from "@/lib/assistantThread";
import type { PlannerMode, PlannerPlan } from "@/lib/plannerAgent";

// The single "ask the analyst / assistant" panel, embedded in the AnalystRail
// on Reports, Segments, and Campaigns. The conversation itself lives in
// lib/assistantThread.ts and is shared across all three — this component just
// renders it and decides what a NEW message here should do. Every past
// exchange renders regardless of which page produced it, and its full text
// goes back to whichever backend answers the next question, so "how many are
// at risk" on Reports and "build a campaign for them" on Campaigns is one
// conversation, not two.

export type AssistantTarget =
  | { kind: "analyst" }
  | {
      kind: "planner";
      mode: PlannerMode;
      // Live count for a proposed audience, computed by the current page with
      // the same engine the builder preview uses. Works for ANY plan in the
      // thread, not just ones built in this mode — a plan's audience
      // definition is portable, only Apply is mode-specific.
      matchCount: (plan: PlannerPlan) => { matched: number; reachable: number };
      onApply: (plan: PlannerPlan) => void;
    };

const MODE_LABEL: Record<PlannerMode, string> = {
  segment: "Segments",
  campaign: "Campaigns",
  journey: "Campaigns → Journeys",
};

const PLACEHOLDER: Record<"analyst" | PlannerMode, string> = {
  analyst: 'Try "Which campaign earned the most?"',
  segment: 'Try "Everyone who\'s spent over $100 but hasn\'t visited in 6 weeks"',
  campaign: 'Try "Create a win-back campaign for regulars who haven\'t been in for a month"',
  journey: 'Try "Win back regulars who go quiet — wait a week, then check in, then follow up"',
};

export function AssistantChat({
  target,
  ready,
  keyName,
  prefill,
}: {
  target: AssistantTarget;
  ready: boolean;
  keyName: string;
  // "Ask why" on a Reports finding prefills the input; the user still presses
  // Send, so every model call stays human-initiated.
  prefill?: { text: string; n: number } | null;
}) {
  const [exchanges, setExchanges] = useState<AssistantExchange[]>(() => loadThread());
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [appliedId, setAppliedId] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (prefill && prefill.n > 0) {
      setInput(prefill.text);
      inputRef.current?.focus();
    }
  }, [prefill]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [exchanges, busy]);

  // overrideText lets a clicked suggestion chip send immediately, bypassing
  // the input box — same call either way, so a chip is just a shortcut for
  // typing that text and pressing Send.
  function send(overrideText?: string) {
    const question = (overrideText ?? input).trim();
    if (!question || busy) return;
    const historyForCall = threadHistory(exchanges);
    if (!overrideText) setInput("");
    setError(null);
    startTransition(async () => {
      if (target.kind === "analyst") {
        const result = await askAnalyst(question, historyForCall);
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setExchanges((prev) => {
          const next: AssistantExchange[] = [
            ...prev,
            {
              id: crypto.randomUUID(),
              question,
              kind: "analyst",
              answer: result.answer,
              suggestions: result.suggestions,
            },
          ];
          saveThread(next);
          return next;
        });
      } else {
        const result = await planWithAssistant(target.mode, question, historyForCall);
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setExchanges((prev) => {
          const next: AssistantExchange[] = [
            ...prev,
            { id: crypto.randomUUID(), question, kind: "planner", mode: target.mode, plan: result.plan },
          ];
          saveThread(next);
          return next;
        });
      }
    });
  }

  if (!ready) {
    return (
      <div className="p-3">
        <p className="text-sm text-muted-foreground">
          Not connected yet. Add{" "}
          <code className="text-xs bg-muted rounded px-1">{keyName}</code> to the
          server environment and redeploy to switch it on. The rest of this
          page works without it.
        </p>
      </div>
    );
  }

  return (
    <section className="flex flex-col flex-1 min-h-0">
      <div className="px-3 pt-3 pb-2 flex items-baseline justify-between gap-2">
        <p className="text-xs text-muted-foreground/70">
          {target.kind === "analyst"
            ? "Answers come only from your dashboard numbers — it can't change anything."
            : "It proposes — nothing is saved until you apply it."}
        </p>
        {exchanges.length > 0 && (
          <button
            type="button"
            onClick={() => {
              setExchanges([]);
              clearThread();
              setError(null);
              setAppliedId(null);
            }}
            className="text-xs text-muted-foreground/70 hover:text-foreground whitespace-nowrap"
          >
            Clear
          </button>
        )}
      </div>

      {(exchanges.length > 0 || busy) && (
        <div ref={logRef} className="overflow-y-auto space-y-3 flex-1 min-h-0 px-3 pb-2">
          {exchanges.map((ex, i) => {
            // Suggestions only make sense off the most recent exchange — once
            // busy, a new one is already in flight.
            const showSuggestions = i === exchanges.length - 1 && !busy;
            const suggestions = ex.kind === "analyst" ? ex.suggestions : ex.plan.suggestions;
            return (
              <div key={ex.id} className="space-y-2">
                <p className="text-sm bg-primary text-primary-foreground rounded-xl rounded-br-sm px-3 py-2 ml-10 w-fit max-w-full whitespace-pre-wrap">
                  {ex.question}
                </p>
                {ex.kind === "analyst" ? (
                  <p className="text-sm bg-muted rounded-xl rounded-bl-sm px-3 py-2 mr-10 w-fit max-w-full whitespace-pre-wrap">
                    {ex.answer}
                  </p>
                ) : (
                  <PlanCard
                    exchange={ex}
                    target={target}
                    applied={appliedId === ex.id}
                    onApplied={() => setAppliedId(ex.id)}
                  />
                )}
                {showSuggestions && suggestions.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mr-10">
                    {suggestions.map((s, j) => (
                      <button
                        key={j}
                        type="button"
                        onClick={() => send(s)}
                        className="text-xs rounded-full border border-input bg-card px-3 py-1 text-foreground/80 hover:border-ring hover:bg-muted"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          {busy && (
            <p className="text-sm text-muted-foreground/70 animate-pulse">
              {target.kind === "analyst"
                ? "Reading your numbers…"
                : "Working out who this should reach…"}
            </p>
          )}
        </div>
      )}

      {error && <p className="pb-2 text-sm text-destructive px-3">{error}</p>}

      {/* mt-auto pins the composer to the bottom when the log is short. */}
      <div className="border-t border-border/60 p-3 flex gap-2 items-end mt-auto">
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
          placeholder={PLACEHOLDER[target.kind === "analyst" ? "analyst" : target.mode]}
          className="flex-1 resize-none text-sm border border-input rounded-lg px-3 py-2 focus:outline-none focus:border-ring"
        />
        <button
          onClick={() => send()}
          disabled={busy || !input.trim()}
          className="text-sm bg-primary text-primary-foreground rounded-lg px-4 py-2 disabled:opacity-40"
        >
          {busy ? "…" : "Send"}
        </button>
      </div>
    </section>
  );
}

function PlanCard({
  exchange,
  target,
  applied,
  onApplied,
}: {
  exchange: Extract<AssistantExchange, { kind: "planner" }>;
  target: AssistantTarget;
  applied: boolean;
  onApplied: () => void;
}) {
  const { plan, mode } = exchange;
  const canApply = target.kind === "planner" && target.mode === mode;
  const counts = target.kind === "planner" ? target.matchCount(plan) : null;

  return (
    <div className="mr-10 rounded-lg border border-border bg-muted/60 p-3 space-y-3">
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

      {mode === "journey" && plan.flow && (
        <ol className="space-y-2">
          {plan.flow.map((s, i) => (
            <li key={i} className="rounded-lg bg-background p-3">
              {s.kind === "wait" ? (
                <p className="text-sm text-muted-foreground">
                  Wait {s.days} day{s.days === 1 ? "" : "s"}
                </p>
              ) : (
                <>
                  <p className="text-xs text-muted-foreground mb-1">{s.channel} draft</p>
                  <p className="text-sm whitespace-pre-wrap">{s.body}</p>
                </>
              )}
            </li>
          ))}
        </ol>
      )}

      {mode === "campaign" && plan.body && (
        <div className="rounded-lg bg-background p-3 space-y-1">
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

      {canApply ? (
        <div className="flex items-center gap-3">
          <button
            onClick={() => {
              target.kind === "planner" && target.onApply(plan);
              onApplied();
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
      ) : (
        <p className="text-xs text-muted-foreground/70">
          Proposed for {MODE_LABEL[mode]} — switch there to apply it.
        </p>
      )}
    </div>
  );
}
