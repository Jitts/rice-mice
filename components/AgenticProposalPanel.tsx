"use client";

import { useState } from "react";
import { executeAgenticTag } from "@/app/actions/agentic";
import type { AgenticProposal } from "@/lib/agentic";

// The draft → review → approve → execute loop for a finding's proposed agent
// action (Sprint 35). The proposal's targets are computed by the deterministic
// findings engine; here a human sees the exact list, approves, and the server
// action performs the tag write + writes an audit row. Nothing runs without
// this explicit click — the assistant only ever prepares the change.

type Phase = "idle" | "review" | "working" | "done" | "error";

const PREVIEW = 12;

export function AgenticProposalPanel({
  proposal,
  source,
  canApply,
}: {
  proposal: AgenticProposal;
  source: string;
  canApply: boolean;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [message, setMessage] = useState("");

  // Roles without the Customer-data permission can't apply tags — say so plainly
  // rather than showing a button that would be rejected server-side.
  if (!canApply) {
    return (
      <p className="rounded-lg bg-muted border border-border px-3 py-2 text-xs text-muted-foreground">
        The assistant can tag these {proposal.targets.length} for “{proposal.tag}”,
        but that needs the Customer data permission.
      </p>
    );
  }

  const n = proposal.targets.length;

  async function approve() {
    setPhase("working");
    const res = await executeAgenticTag({
      type: proposal.type,
      tag: proposal.tag,
      customerIds: proposal.targets.map((t) => t.id),
      source,
    });
    if (res.ok) {
      setPhase("done");
      setMessage(
        res.changed === 0
          ? "Already tagged — nothing to change."
          : `Tagged ${res.changed} customer${res.changed === 1 ? "" : "s"} “${proposal.tag}”.`,
      );
    } else {
      setPhase("error");
      setMessage(res.error);
    }
  }

  if (phase === "done") {
    return (
      <p className="rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 px-3 py-2 text-xs text-emerald-800 dark:text-emerald-200">
        ✓ {message}
      </p>
    );
  }

  return (
    <div className="rounded-lg bg-violet-50/60 dark:bg-violet-950/40 border border-violet-200 dark:border-violet-800 px-3 py-2">
      {phase === "idle" && (
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-violet-900 dark:text-violet-200">
            ⚡ The assistant can tag {n} customer{n === 1 ? "" : "s"} “{proposal.tag}”.
          </p>
          <button
            onClick={() => setPhase("review")}
            className="shrink-0 text-xs font-medium text-violet-700 dark:text-violet-300 underline underline-offset-2 hover:text-violet-900 dark:hover:text-violet-100"
          >
            Review →
          </button>
        </div>
      )}

      {(phase === "review" || phase === "working" || phase === "error") && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-violet-900 dark:text-violet-200">
            Apply the “{proposal.tag}” tag to these {n} customer{n === 1 ? "" : "s"}?
          </p>
          <div className="flex flex-wrap gap-1">
            {proposal.targets.slice(0, PREVIEW).map((t) => (
              <span
                key={t.id}
                className="inline-block rounded-full border border-violet-200 dark:border-violet-800 bg-card px-2 py-0.5 text-[11px] text-foreground/80"
              >
                {t.name}
              </span>
            ))}
            {n > PREVIEW && (
              <span className="inline-block px-2 py-0.5 text-[11px] text-muted-foreground">
                and {n - PREVIEW} more
              </span>
            )}
          </div>
          {phase === "error" && (
            <p className="text-xs text-destructive">{message}</p>
          )}
          <div className="flex items-center gap-2 pt-0.5">
            <button
              onClick={approve}
              disabled={phase === "working"}
              className="rounded-lg bg-violet-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-800 disabled:opacity-60"
            >
              {phase === "working" ? "Applying…" : `Approve & apply`}
            </button>
            <button
              onClick={() => setPhase("idle")}
              disabled={phase === "working"}
              className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-60"
            >
              Cancel
            </button>
          </div>
          <p className="text-[11px] text-muted-foreground/70">
            Reversible — you can remove the tag from any customer’s page. Logged to
            the audit trail.
          </p>
        </div>
      )}
    </div>
  );
}
