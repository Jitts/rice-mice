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
      <p className="rounded-lg bg-neutral-50 border border-neutral-200 px-3 py-2 text-xs text-neutral-500">
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
      <p className="rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2 text-xs text-emerald-800">
        ✓ {message}
      </p>
    );
  }

  return (
    <div className="rounded-lg bg-violet-50/60 border border-violet-200 px-3 py-2">
      {phase === "idle" && (
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-violet-900">
            ⚡ The assistant can tag {n} customer{n === 1 ? "" : "s"} “{proposal.tag}”.
          </p>
          <button
            onClick={() => setPhase("review")}
            className="shrink-0 text-xs font-medium text-violet-700 underline underline-offset-2 hover:text-violet-900"
          >
            Review →
          </button>
        </div>
      )}

      {(phase === "review" || phase === "working" || phase === "error") && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-violet-900">
            Apply the “{proposal.tag}” tag to these {n} customer{n === 1 ? "" : "s"}?
          </p>
          <div className="flex flex-wrap gap-1">
            {proposal.targets.slice(0, PREVIEW).map((t) => (
              <span
                key={t.id}
                className="inline-block rounded-full border border-violet-200 bg-white px-2 py-0.5 text-[11px] text-neutral-700"
              >
                {t.name}
              </span>
            ))}
            {n > PREVIEW && (
              <span className="inline-block px-2 py-0.5 text-[11px] text-neutral-500">
                and {n - PREVIEW} more
              </span>
            )}
          </div>
          {phase === "error" && (
            <p className="text-xs text-red-600">{message}</p>
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
              className="text-xs text-neutral-500 hover:text-neutral-800 disabled:opacity-60"
            >
              Cancel
            </button>
          </div>
          <p className="text-[11px] text-neutral-400">
            Reversible — you can remove the tag from any customer’s page. Logged to
            the audit trail.
          </p>
        </div>
      )}
    </div>
  );
}
