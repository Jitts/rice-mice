"use server";

// Backend for the planner chat on Segments and Campaigns. Same posture as the
// analyst and copilot: permission-gated, per-shop daily AI cap, every exchange
// audited. It returns a PROPOSAL — validated against the live field registry —
// and writes nothing. Applying a plan goes through the existing save paths the
// human already drives.

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { can } from "@/lib/permissions";
import { buildFieldRegistry, type CustomFieldRow } from "@/lib/segments";
import { channelStatuses, type CampaignChannel } from "@/lib/campaigns";
import { connectedChannels } from "@/lib/providerConfig";
import {
  parsePlan,
  plannerSystemPrompt,
  type PlannerMode,
  type PlannerPlan,
} from "@/lib/plannerAgent";
import {
  analystKeyEnvName,
  analystKeyPresent,
  resolveAnalystModel,
} from "@/lib/analystModel";
import { runAnalyst, runFailureMessage } from "@/lib/analystRunner";
import { withinDailyAiCap } from "@/lib/aiUsage";

export type PlannerTurn = { role: "user" | "assistant"; content: string };

export type PlanResult =
  | { ok: true; plan: PlannerPlan }
  | { ok: false; error: string };

const MAX_REQUEST_CHARS = 600;
const MAX_HISTORY_TURNS = 6;

type MembershipJoin = {
  business_id: string;
  roles: { permissions: string[] } | null;
  businesses: Record<string, unknown> | null;
} | null;

export async function planWithAssistant(
  mode: PlannerMode,
  request: string,
  history: PlannerTurn[],
): Promise<PlanResult> {
  const trimmed = request.trim();
  if (!trimmed) return { ok: false, error: "Describe what you'd like to build first." };
  if (trimmed.length > MAX_REQUEST_CHARS)
    return { ok: false, error: `Keep it under ${MAX_REQUEST_CHARS} characters.` };
  if (mode !== "segment" && mode !== "campaign")
    return { ok: false, error: "Unknown planner mode." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "You need to be signed in." };

  const { data: membershipRow } = await supabase
    .from("memberships")
    .select("business_id, roles(permissions), businesses(*)")
    .eq("user_id", user.id)
    .maybeSingle();
  const membership = membershipRow as MembershipJoin;
  if (!membership?.businesses)
    return { ok: false, error: "No shop found for your account." };

  // Campaign plans need the campaigns permission; segment plans need segments.
  const needed = mode === "campaign" ? "campaigns" : "segments";
  if (!can(membership.roles?.permissions, needed))
    return { ok: false, error: `Your role doesn't include the ${needed} permission.` };

  if (!analystKeyPresent())
    return {
      ok: false,
      error: `The assistant isn't connected yet — add ${analystKeyEnvName()} to the server environment and redeploy.`,
    };

  const admin = createAdminClient();
  if (!(await withinDailyAiCap(admin, membership.business_id)))
    return {
      ok: false,
      error: "Your shop has reached today's AI usage limit — it resets at midnight UTC.",
    };

  // Same RLS-scoped reads the builder screens make; the tenant fence is automatic.
  const [{ data: customFields }, { data: segments }, { count: customerCount }] =
    await Promise.all([
      supabase.from("custom_fields").select("*").order("sort_order"),
      supabase.from("segments").select("id, name"),
      supabase.from("customers").select("id", { count: "exact", head: true }),
    ]);

  const registry = buildFieldRegistry((customFields ?? []) as CustomFieldRow[]);
  const savedSegments = (segments ?? []) as { id: string; name: string }[];
  const validSegmentIds = new Set(savedSegments.map((s) => s.id));

  // Only offer channels that can actually send today — a plan on a dead
  // channel would be a dead end the user only discovers at send time.
  const connected = await connectedChannels(membership.business_id);
  const sendableChannels = channelStatuses(connected)
    .filter((c) => c.selectable)
    .map((c) => c.id as CampaignChannel);
  if (mode === "campaign" && sendableChannels.length === 0)
    return { ok: false, error: "No channel is ready to send on yet — connect one in Settings." };

  const business = membership.businesses;
  const model = resolveAnalystModel(business.analyst_model as string | undefined);

  const system = plannerSystemPrompt({
    mode,
    shopName: String(business.shop_name ?? business.name ?? "the shop"),
    fieldsById: registry.byId,
    savedSegments,
    sendableChannels,
    customerCount: customerCount ?? 0,
  });

  const pastTurns = history
    .slice(-MAX_HISTORY_TURNS)
    .filter((t) => (t.role === "user" || t.role === "assistant") && t.content)
    .map((t) => ({ role: t.role, content: t.content.slice(0, 2000) }));
  while (pastTurns.length > 0 && pastTurns[0].role !== "user") pastTurns.shift();

  const run = await runAnalyst({
    system,
    turns: [...pastTurns, { role: "user" as const, content: trimmed }],
    model,
    maxTokens: 2048,
  });

  let outcome: "success" | "failed" = "success";
  let plan: PlannerPlan | null = null;
  let error = "The assistant couldn't plan that just now — try again.";

  if (run.ok) {
    const parsed = parsePlan(run.text, {
      mode,
      fieldsById: registry.byId,
      sendableChannels,
      validSegmentIds,
    });
    if (parsed.ok) plan = parsed.plan;
    else {
      outcome = "failed";
      error = parsed.error;
    }
  } else {
    outcome = "failed";
    error = runFailureMessage(run, "assistant", analystKeyEnvName());
  }

  if (admin) {
    const { data: profile } = await supabase
      .from("staff_profiles")
      .select("display_name")
      .eq("id", user.id)
      .maybeSingle();
    await admin.from("audit_log").insert({
      business_id: membership.business_id,
      actor: profile?.display_name ?? user.id,
      action: "planner.propose",
      target_id: membership.business_id,
      payload_snapshot: {
        model,
        mode,
        request: trimmed.slice(0, 300),
        plan_name: plan?.name ?? null,
        concern_count: plan?.concerns.length ?? 0,
        ...(run.ok
          ? { input_tokens: run.input_tokens, output_tokens: run.output_tokens }
          : { error_kind: run.kind, error_detail: run.message }),
        ...(outcome === "failed" ? { reject_reason: error.slice(0, 200) } : {}),
      },
      outcome,
    });
  }

  if (!plan) return { ok: false, error };
  return { ok: true, plan };
}
