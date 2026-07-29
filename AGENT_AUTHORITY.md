# rice-mice — Agent Authority & Operating Rules

This file governs what any AI agent (Paperclip-run or otherwise) is allowed to do when helping
operate the rice-mice business itself — SEO/marketing, sales outreach, and customer support.
It does **not** cover the product's own in-app agentic layer (Sprint 35's customer-facing AI) —
that has its own hard-locks already built into the codebase. This file is the equivalent
boundary for agents helping *you* run the business.

## Principle
The same trust boundary you designed into the product for its users applies to you, running
your own business — arguably more strictly, since real prospects, real customers, and your
reputation are on the line, not a sandboxed internal tool.

## Authority tiers

**T0 — Advisory: read-only, produces findings, changes nothing.**
Reviewer agents (`.claude/agents/`) that read the codebase and report. They may
read files, grep, and run read-only commands (`git diff`, `git log`, `npm test`,
`tsc --noEmit`). They may **not** edit files, write to any database, deploy,
send anything, or spend money — and their findings are advisory: a human decides
what to act on. Because they cannot change anything, they need no approval to
run.

Current T0 agents: `security-reviewer`, `consent-reviewer`, `code-reviewer`,
`design-reviewer`, `copy-reviewer`.

The `red-team` agent is T0 in authority but carries extra constraints, since it
probes a **running** instance rather than reading code: a seeded QA project only,
never production, never writes, never real customer data. Those limits are
written into its definition and restate T3 below — they are not discretionary.

Why no separate governance agent: every T0 agent is read-only, so the
enforcement is that they cannot act, not that something watches them. A
governance agent policing advisory agents would be machinery guarding
machinery. Revisit only if an agent is ever promoted out of T0.

**T1 — Autonomous, no approval needed:**
- SEO/content research: keyword research, competitor scans, on-page audits
- Drafting blog posts, landing page copy, social captions
- Internal reporting, analytics summaries, findings/insights generation
- Answering clearly factual, no-stakes customer questions (hours, how sign-up works, how loyalty
  points work) — **only** once you've reviewed enough of the agent's answers in this category to
  trust it; starts as T2 by default for a new agent, can be promoted to T1 once proven

**T2 — Draft, then Founder approves before it goes out:**
- Publishing new SEO content live (until proven — see below)
- Any sales outreach message to a lead or prospect
- Any customer support response touching refunds, complaints, billing, or anything with money
  or reputation attached
- Anything the agent itself flags as uncertain or outside its confident scope

**T3 — Founder only, agent must never execute, ever:**
- Delete — any customer, business, or transaction record
- Refund — any transaction
- Export — any customer data, in bulk or individually
- Message-send — direct, unsupervised outbound contact to a real customer or prospect
  (matches the product's own hard-locked action list exactly — no looser here than there)
- Any spend of real money (ad spend, subscriptions, contractor payments)
- Anything touching production Supabase directly, or any deploy to production

## Promotion path (T2 → T1)
Don't hand-wave an agent into full autonomy. For each capability currently gated at T2:
1. Review a batch of its drafts (suggest: at least 10-15 for content, 20+ for support replies)
2. Confirm quality/voice/accuracy is consistently right
3. Explicitly promote that specific capability to T1 — do this one capability at a time, not
   as a blanket "trust this agent now"

## Escalate immediately when
- A prospect or customer asks something the agent isn't confident about
- Any request touches money, legal, or personal data handling
- Anything that would require T3 action to fulfill

## Logging
Keep it lightweight — a single `AGENT_LOG.md` noting: what the agent did, what it drafted vs.
executed, and any T2 items awaiting your approval. This doesn't need GENESIS's full
DECISION_LOG/ASSUMPTIONS/SPRINT_TRACKER machinery — rice-mice is one product with one clear
roadmap, not a multi-track discovery sprint.

## Scope note
This file governs two of the three agent categories around rice-mice:

1. **Business-operations agents** (SEO, sales, support, and the `storyteller`) — T1/T2/T3 above.
   The storyteller drafts autonomously (T1) but publishing stays T2.
2. **Engineering reviewer agents** (`.claude/agents/`) — T0 above. Added 2026-07-29; before that
   they sat outside any written governance, since this file originally covered business-ops only.
3. **The product's own in-app agentic layer** — NOT governed here. It has hard locks compiled into
   the codebase (`lib/agentic.ts`, pinned by `tests/agentic.test.ts`), which is a stronger
   guarantee than a document. Its locked classes and T3 below are deliberately the same list.

Hands-on product engineering in Claude Code is unchanged by this file — a human is driving and
approving each step there. T0 exists for agents reviewing that work unattended.
