"use server";

// The analyst Q&A backend. Read-only by construction: the caller's question
// is answered against a snapshot built from the SAME RLS-scoped queries the
// dashboard uses — the model holds no tools, no keys, and no write path.
// Every exchange is written to audit_log (action "analyst.qa") so usage and
// answer quality can be evaluated from day one.

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { can } from "@/lib/permissions";
import { withRuleDefaults } from "@/lib/marketing";
import { withLoyaltyDefaults, type Reward } from "@/lib/loyalty";
import { buildProfiles, type CustomerRow } from "@/lib/segments";
import type { Order } from "@/lib/orders";
import { buildFindings, type FindingCampaign, type FindingLog } from "@/lib/findings";
import { analystSystemPrompt, buildSnapshot } from "@/lib/analyst";
import {
  analystKeyEnvName,
  analystKeyPresent,
  resolveAnalystModel,
} from "@/lib/analystModel";
import { runAnalyst } from "@/lib/analystRunner";

export type AnalystTurn = { role: "user" | "assistant"; content: string };

export type AskResult =
  | { ok: true; answer: string }
  | { ok: false; error: string };

const MAX_QUESTION_CHARS = 600;
const MAX_HISTORY_TURNS = 8;
const MAX_TURN_CHARS = 4000;

type MembershipJoin = {
  business_id: string;
  roles: { permissions: string[] } | null;
  businesses: Record<string, unknown> | null;
} | null;

export async function askAnalyst(
  question: string,
  history: AnalystTurn[],
): Promise<AskResult> {
  const trimmed = question.trim();
  if (!trimmed) return { ok: false, error: "Ask a question first." };
  if (trimmed.length > MAX_QUESTION_CHARS)
    return { ok: false, error: `Keep questions under ${MAX_QUESTION_CHARS} characters.` };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "You need to be signed in." };

  // Self, not the roster — RLS shows every membership in the business.
  const { data: membershipRow } = await supabase
    .from("memberships")
    .select("business_id, roles(permissions), businesses(*)")
    .eq("user_id", user.id)
    .maybeSingle();
  const membership = membershipRow as MembershipJoin;
  if (!membership?.businesses)
    return { ok: false, error: "No shop found for your account." };
  if (!can(membership.roles?.permissions, "reports"))
    return { ok: false, error: "Your role doesn't include the Reports permission." };

  if (!analystKeyPresent())
    return {
      ok: false,
      error: `The analyst isn't connected yet — add ${analystKeyEnvName()} to the server environment and redeploy.`,
    };

  // Same RLS-scoped reads the dashboard makes; the tenant fence is automatic.
  const [
    { data: orders },
    { data: customers },
    { data: campaigns },
    { data: logs },
    { data: rewards },
  ] = await Promise.all([
    supabase.from("orders").select("*, order_items(*)"),
    supabase.from("customers").select("*"),
    supabase.from("campaigns").select("id, name"),
    supabase.from("engagement_logs").select("campaign_id, customer_id, sent_at"),
    supabase
      .from("rewards")
      .select("id, name, description, points_cost, benefit_type, benefit_value, active"),
  ]);

  const business = membership.businesses;
  // The business's chosen model, validated against the active provider's
  // curated list (falls back to the provider default if unset or stale).
  const model = resolveAnalystModel(business.analyst_model as string | undefined);
  const rules = withRuleDefaults(business);
  const loyalty = withLoyaltyDefaults(business);
  const orderRows = (orders ?? []) as Order[];
  const profiles = buildProfiles((customers ?? []) as CustomerRow[], orderRows);
  const campaignRows = (campaigns ?? []) as FindingCampaign[];
  const logRows = (logs ?? []) as FindingLog[];
  const rewardRows = (rewards ?? []) as Reward[];

  const findings = buildFindings({
    orders: orderRows,
    profiles,
    campaigns: campaignRows,
    logs: logRows,
    rules,
    loyalty,
    rewards: rewardRows,
  });

  const snapshot = buildSnapshot({
    shopName: String(business.name ?? "the shop"),
    orders: orderRows,
    profiles,
    campaigns: campaignRows,
    logs: logRows,
    rules,
    loyalty,
    rewards: rewardRows,
    findings,
  });

  // Sanitize the history the client sent: cap length, force valid roles, and
  // make sure the conversation starts with a user turn.
  const pastTurns = history
    .slice(-MAX_HISTORY_TURNS)
    .filter((t) => (t.role === "user" || t.role === "assistant") && t.content)
    .map((t) => ({ role: t.role, content: t.content.slice(0, MAX_TURN_CHARS) }));
  while (pastTurns.length > 0 && pastTurns[0].role !== "user") pastTurns.shift();

  let outcome: "success" | "failed" = "success";
  let answer = "";
  let usage: { input_tokens?: number; output_tokens?: number } = {};
  let failure = "The analyst couldn't answer just now — try again in a moment.";

  const run = await runAnalyst({
    system: analystSystemPrompt(snapshot),
    turns: [...pastTurns, { role: "user" as const, content: trimmed }],
    model,
  });

  if (run.ok) {
    answer = run.text;
    usage = { input_tokens: run.input_tokens, output_tokens: run.output_tokens };
  } else {
    outcome = "failed";
    failure =
      run.kind === "rate"
        ? "The analyst is busy right now — try again in a minute."
        : run.kind === "auth"
          ? `The analyst's API key is invalid — check ${analystKeyEnvName()}.`
          : run.kind === "refusal"
            ? "The analyst declined to answer that question."
            : run.kind === "empty"
              ? "The analyst returned an empty answer — try rephrasing."
              : "The analyst hit an API error — try again shortly.";
  }

  // Eval log — one row per exchange, question + token counts, never the full
  // snapshot (it's rebuildable) and only a preview of the answer.
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
      action: "analyst.qa",
      target_id: membership.business_id,
      payload_snapshot: {
        model,
        question: trimmed.slice(0, 300),
        answer_preview: answer.slice(0, 300),
        history_turns: pastTurns.length,
        ...usage,
        ...(run.ok ? {} : { error_kind: run.kind, error_detail: run.message }),
      },
      outcome,
    });
  }

  if (outcome === "failed") return { ok: false, error: failure };
  return { ok: true, answer };
}
