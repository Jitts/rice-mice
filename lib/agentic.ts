// The autonomy ladder (Sprint 35). This is the single registry that governs
// which AGENT-INITIATED actions may execute and how much human involvement each
// needs. It encodes docs/AGENTIC_LAYER.md in code so the classification is not
// just documentation — the executor (app/actions/agentic.ts) reads this to
// decide what it is allowed to do, and the critical classes are HARD-LOCKED
// here (never executable by an agent, regardless of any setting).
//
// The ladder has three rungs:
//   auto   — may execute unattended (reserved for low-risk, reversible actions;
//            NO action is classified auto in v1 — the first unattended rung is a
//            deliberate later step, gated behind the red-team review).
//   ask    — draft → a human reviews the concrete change → approves → execute →
//            audit. This is the only rung that actually runs in v1.
//   locked — an agent may NEVER perform this. It stays a human-only action in
//            the normal UI. Delete customer, refund, export database, and any
//            message send (incl. bulk) live here — permanently.
//
// Pure module: no I/O, no secrets. Unit-tested in tests/agentic.test.ts.

export type RiskLevel = "low" | "medium" | "high" | "critical";
export type AutonomyMode = "auto" | "ask" | "locked";

export type AgenticActionType =
  // Enabled in v1 (ask-flow):
  | "tag.apply" // add a tag to a computed audience
  | "tag.remove" // remove a tag from a computed audience
  // Locked forever — an agent can never do these (human-only in the normal UI):
  | "customer.delete" // Critical: delete a customer record
  | "order.refund" // Critical: refund a transaction
  | "customers.export" // Critical: export the full customer database
  | "message.send"; // Critical (our stance): any agent-initiated send, incl. bulk

export type AgenticActionDef = {
  type: AgenticActionType;
  label: string;
  risk: RiskLevel;
  mode: AutonomyMode;
  reversible: boolean;
  // One line the UI can show to explain why a locked action is locked.
  lockedReason?: string;
};

// A concrete, ready-to-review action an agent (here: the deterministic findings
// engine) proposes. The targets are EXACT and computed — never invented — so
// the human reviews precisely who is affected before approving. v1 proposals
// are tag changes only.
export type AgenticProposal = {
  type: Extract<AgenticActionType, "tag.apply" | "tag.remove">;
  tag: string;
  targets: { id: string; name: string }[];
};

// The catalog. Everything an agent could conceivably do is listed with its rung,
// so "what can the agent do" is answerable by reading one array. Adding a new
// executable action means adding it here with mode "ask" (or, later and
// deliberately, "auto") — never leaving a capability unclassified.
export const AGENTIC_ACTIONS: AgenticActionDef[] = [
  {
    type: "tag.apply",
    label: "Apply a tag to a reviewed audience",
    risk: "medium",
    mode: "ask",
    reversible: true,
  },
  {
    type: "tag.remove",
    label: "Remove a tag from a reviewed audience",
    risk: "medium",
    mode: "ask",
    reversible: true,
  },
  {
    type: "customer.delete",
    label: "Delete a customer record",
    risk: "critical",
    mode: "locked",
    reversible: false,
    lockedReason:
      "Deleting a customer is irreversible and stays human-only — do it from the customer's page.",
  },
  {
    type: "order.refund",
    label: "Refund a transaction",
    risk: "critical",
    mode: "locked",
    reversible: false,
    lockedReason: "Refunds move money and stay human-only — do it from the order.",
  },
  {
    type: "customers.export",
    label: "Export the full customer database",
    risk: "critical",
    mode: "locked",
    reversible: false,
    lockedReason:
      "A full-database export is human-only — use the CSV export on Reports yourself.",
  },
  {
    type: "message.send",
    label: "Send a message to customers",
    risk: "critical",
    mode: "locked",
    reversible: false,
    lockedReason:
      "No agent has a send path. Every send is a human action in the composer, after the consent checks.",
  },
];

const BY_TYPE: Record<string, AgenticActionDef> = Object.fromEntries(
  AGENTIC_ACTIONS.map((a) => [a.type, a]),
);

export function agenticActionDef(type: string): AgenticActionDef | null {
  return BY_TYPE[type] ?? null;
}

// True only for a known action explicitly on the "ask" rung. An unknown type is
// NOT executable — the executor must default to refusing anything it can't find
// here (fail closed).
export function isApprovable(type: string): boolean {
  return BY_TYPE[type]?.mode === "ask";
}

// The hard wall. Locked (critical) actions can never run as an agent action —
// and, defensively, anything not in the catalog is treated as locked too, so a
// crafted request for an unlisted type is refused rather than waved through.
export function isLocked(type: string): boolean {
  const def = BY_TYPE[type];
  return !def || def.mode === "locked";
}

// The single guard the executor calls before doing anything. Only an approvable
// (ask-rung) known action clears it; auto/locked/unknown are refused. v1 has no
// unattended path, so `auto` is refused here too until it is deliberately opened.
export function canAgentExecute(type: string): boolean {
  return isApprovable(type);
}

// The classes that are human-only forever, for docs/UI to enumerate honestly.
export function lockedActions(): AgenticActionDef[] {
  return AGENTIC_ACTIONS.filter((a) => a.mode === "locked");
}
