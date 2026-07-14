"use server";

// The analyst Q&A backend. Read-only by construction: the caller's question
// is answered against a snapshot built from the SAME RLS-scoped queries the
// dashboard uses — the model holds no tools, no keys, and no write path.
// Every exchange is written to audit_log (action "analyst.qa") so usage and
// answer quality can be evaluated from day one.

import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { can } from "@/lib/permissions";
import { withRuleDefaults } from "@/lib/marketing";
import { withLoyaltyDefaults, type Reward } from "@/lib/loyalty";
import { buildProfiles, type CustomerRow } from "@/lib/segments";
import type { Order } from "@/lib/orders";
import { buildFindings, type FindingCampaign, type FindingLog } from "@/lib/findings";
import { analystSystemPrompt, buildSnapshot } from "@/lib/analyst";

export type AnalystTurn = { role: "user" | "assistant"; content: string };

export type AskResult =
  | { ok: true; answer: string }
  | { ok: false; error: string };

const MAX_QUESTION_CHARS = 600;
const MAX_HISTORY_TURNS = 8;
const MAX_TURN_CHARS = 4000;

// Default per the current API guidance; override with RICE_ANALYST_MODEL if
// per-tenant cost calls for a smaller model later.
const MODEL = process.env.RICE_ANALYST_MODEL || "claude-opus-4-8";

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

  if (!process.env.ANTHROPIC_API_KEY)
    return {
      ok: false,
      error:
        "The analyst isn't connected yet — add ANTHROPIC_API_KEY to the server environment and redeploy.",
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

  const client = new Anthropic();
  let outcome: "success" | "failed" = "success";
  let answer = "";
  let usage: { input_tokens?: number; output_tokens?: number } = {};
  let failure = "The analyst couldn't answer just now — try again in a moment.";

  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 8000,
      thinking: { type: "adaptive" },
      output_config: { effort: "medium" },
      system: analystSystemPrompt(snapshot),
      messages: [...pastTurns, { role: "user" as const, content: trimmed }],
    });
    usage = {
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
    };
    if (response.stop_reason === "refusal") {
      outcome = "failed";
      failure = "The analyst declined to answer that question.";
    } else {
      answer = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("")
        .trim();
      if (!answer) {
        outcome = "failed";
        failure = "The analyst returned an empty answer — try rephrasing.";
      }
    }
  } catch (err) {
    outcome = "failed";
    if (err instanceof Anthropic.RateLimitError) {
      failure = "The analyst is busy right now — try again in a minute.";
    } else if (err instanceof Anthropic.AuthenticationError) {
      failure = "The analyst's API key is invalid — check ANTHROPIC_API_KEY.";
    } else if (err instanceof Anthropic.APIError) {
      failure = "The analyst hit an API error — try again shortly.";
    }
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
        model: MODEL,
        question: trimmed.slice(0, 300),
        answer_preview: answer.slice(0, 300),
        history_turns: pastTurns.length,
        ...usage,
      },
      outcome,
    });
  }

  if (outcome === "failed") return { ok: false, error: failure };
  return { ok: true, answer };
}
