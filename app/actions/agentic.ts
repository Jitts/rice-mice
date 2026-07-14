"use server";

// The autonomy-ladder executor (Sprint 35). This is the ONE place an
// agent-proposed action actually writes. It runs only after a human has
// reviewed the concrete targets and clicked Approve, and it re-checks
// everything server-side (never trusting the client):
//   1. signed in
//   2. a membership in a business (self lookup, not the roster)
//   3. the permission the equivalent manual edit requires (`customers` for tags)
//   4. the action type is on the "ask" rung of lib/agentic.ts — critical /
//      locked / unknown types are refused here, so the hard wall holds even if
//      a crafted request reaches this action
//   5. the blast radius is bounded (a capped number of targets per call)
// The write goes through the RLS-scoped client, so a customer id from another
// tenant simply matches no row — cross-tenant tagging is structurally
// impossible. Every run writes an audit_log `agent.execute` row.

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { can } from "@/lib/permissions";
import { agenticActionDef, canAgentExecute } from "@/lib/agentic";

export type AgenticResult =
  | { ok: true; changed: number; requested: number }
  | { ok: false; error: string };

// Bounds the blast radius of a single approval — a bulk tag is still a bulk
// action. Comfortably above any realistic at-risk cohort for one shop.
const MAX_TARGETS = 500;
const TAG_MAX = 40;

type MembershipJoin = {
  business_id: string;
  roles: { permissions: string[] } | null;
} | null;

export async function executeAgenticTag(input: {
  type: string; // "tag.apply" | "tag.remove"
  tag: string;
  customerIds: string[];
  source: string; // provenance, e.g. "finding:quiet_regulars"
}): Promise<AgenticResult> {
  const def = agenticActionDef(input.type);
  // The hard wall: only an approvable (ask-rung) known action clears the guard.
  // Locked/critical/unknown types are refused before anything is loaded.
  if (!def || !canAgentExecute(input.type)) {
    return {
      ok: false,
      error: def?.lockedReason ?? "That action can't be performed by the assistant.",
    };
  }
  if (def.type !== "tag.apply" && def.type !== "tag.remove") {
    // This executor only knows how to do tag changes; any other ask-rung action
    // added later needs its own branch rather than falling through to a write.
    return { ok: false, error: "That action isn't supported here yet." };
  }

  const tag = input.tag.trim();
  if (!tag || tag.length > TAG_MAX) return { ok: false, error: "Invalid tag." };

  const ids = Array.from(new Set((input.customerIds ?? []).filter(Boolean)));
  if (ids.length === 0) return { ok: false, error: "No customers to update." };
  if (ids.length > MAX_TARGETS)
    return { ok: false, error: `Too many customers at once (max ${MAX_TARGETS}).` };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "You need to be signed in." };

  // Self, not the roster — RLS shows every membership in the business.
  const { data: membershipRow } = await supabase
    .from("memberships")
    .select("business_id, roles(permissions)")
    .eq("user_id", user.id)
    .maybeSingle();
  const membership = membershipRow as MembershipJoin;
  if (!membership) return { ok: false, error: "No shop found for your account." };
  // Tagging is the `customers` permission — the same gate the manual tag editor
  // uses. An agent action never grants access the human wouldn't already have.
  if (!can(membership.roles?.permissions, "customers"))
    return { ok: false, error: "Your role doesn't include the Customer data permission." };

  // Load only the targeted rows, RLS-scoped: a foreign-tenant id returns nothing
  // and can never be written. Read current tags so apply/remove is a set op.
  const { data: rows, error: readErr } = await supabase
    .from("customers")
    .select("id, tags")
    .in("id", ids);
  if (readErr) return { ok: false, error: "Couldn't load those customers." };

  const targets = (rows ?? []) as { id: string; tags: string[] | null }[];
  let changed = 0;
  for (const row of targets) {
    const current = row.tags ?? [];
    const has = current.includes(tag);
    let next: string[] | null = null;
    if (def.type === "tag.apply" && !has) next = [...current, tag];
    else if (def.type === "tag.remove" && has) next = current.filter((t) => t !== tag);
    if (!next) continue; // already in the desired state — no write, no churn
    const { error } = await supabase
      .from("customers")
      .update({ tags: next })
      .eq("id", row.id);
    if (!error) changed++;
  }

  // Audit every agent execution — actor, the exact action + provenance, how many
  // were requested vs actually changed. This is the eval + accountability trail.
  const admin = createAdminClient();
  if (admin) {
    const { data: profile } = await supabase
      .from("staff_profiles")
      .select("display_name")
      .eq("id", user.id)
      .maybeSingle();
    await admin.from("audit_log").insert({
      business_id: membership.business_id,
      actor: profile?.display_name ?? user.id,
      action: "agent.execute",
      target_id: membership.business_id,
      payload_snapshot: {
        type: def.type,
        tag,
        source: String(input.source ?? "").slice(0, 80),
        requested: ids.length,
        matched: targets.length,
        changed,
      },
      outcome: "success",
    });
  }

  return { ok: true, changed, requested: ids.length };
}
