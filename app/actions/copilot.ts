"use server";

// The marketing copilot's draft endpoint. Draft-only by construction: it
// returns copy for a human to edit/approve/send — it holds no send path, no
// recipient list, and no consent decision (all of that stays in the composer
// and the existing send pipeline). Every draft is written to audit_log
// (action "copilot.draft") so acceptance can be evaluated later.

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { can } from "@/lib/permissions";
import { withLoyaltyDefaults } from "@/lib/loyalty";
import { earningRuleText } from "@/lib/loyalty";
import { analystKeyEnvName, analystKeyPresent, resolveAnalystModel } from "@/lib/analystModel";
import { runAnalyst, runFailureMessage } from "@/lib/analystRunner";
import { withinDailyAiCap } from "@/lib/aiUsage";
import {
  copilotSystemPrompt,
  parseCopilotDrafts,
  TONES,
  type CopilotChannel,
  type CopilotDraft,
  type Tone,
} from "@/lib/copilot";
import type { CampaignChannel } from "@/lib/campaigns";

export type DraftResult =
  | { ok: true; drafts: CopilotDraft[] }
  | { ok: false; error: string };

const VALID_CHANNELS: CampaignChannel[] = [
  "whatsapp",
  "email",
  "sms",
  "telegram",
  "line",
];

const MAX_GOAL_CHARS = 300;

type MembershipJoin = {
  business_id: string;
  roles: { permissions: string[] } | null;
  businesses: Record<string, unknown> | null;
} | null;

export async function draftCampaignCopy(input: {
  channel: string;
  segmentName: string;
  audienceCount: number;
  goal: string;
  tone: string;
  offerLabel: string | null;
}): Promise<DraftResult> {
  const goal = input.goal.trim();
  if (!goal) return { ok: false, error: "Tell the copilot what the message is for." };
  if (goal.length > MAX_GOAL_CHARS)
    return { ok: false, error: `Keep the brief under ${MAX_GOAL_CHARS} characters.` };

  const channel = input.channel as CopilotChannel;
  if (!VALID_CHANNELS.includes(channel))
    return { ok: false, error: "Unknown channel." };

  const tone: Tone = (TONES as readonly string[]).includes(input.tone)
    ? (input.tone as Tone)
    : "warm";

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
  if (!can(membership.roles?.permissions, "campaigns"))
    return { ok: false, error: "Your role doesn't include the Campaigns permission." };

  if (!analystKeyPresent())
    return {
      ok: false,
      error: `The AI copilot isn't connected yet — add ${analystKeyEnvName()} to the server environment and redeploy.`,
    };

  // Per-shop daily cap (red-team gate item 6). Reused for the audit write below.
  const admin = createAdminClient();
  if (!(await withinDailyAiCap(admin, membership.business_id)))
    return {
      ok: false,
      error: "Your shop has reached today's AI usage limit — it resets at midnight UTC.",
    };

  const business = membership.businesses;
  const model = resolveAnalystModel(business.analyst_model as string | undefined);
  const loyalty = withLoyaltyDefaults(business);
  const shopName = String(business.shop_name ?? business.name ?? "our shop");
  const tagline =
    typeof business.tagline === "string" && business.tagline.trim()
      ? business.tagline.trim()
      : null;

  const system = copilotSystemPrompt({
    shopName,
    tagline,
    channel,
    segmentName: input.segmentName || "customers",
    audienceCount: Math.max(0, Math.floor(input.audienceCount) || 0),
    goal,
    tone,
    offerLabel: input.offerLabel?.trim() || null,
    earningRule: earningRuleText(loyalty),
  });

  const run = await runAnalyst({
    system,
    turns: [{ role: "user", content: "Write the message now." }],
    model,
    // Three versions, and email carries a subject line with each.
    maxTokens: 1536,
  });

  let outcome: "success" | "failed" = "success";
  let drafts: CopilotDraft[] = [];
  let error = "The copilot couldn't draft that just now — try again.";

  if (run.ok) {
    drafts = parseCopilotDrafts(run.text, channel);
    if (drafts.length === 0) {
      outcome = "failed";
      error = "The copilot returned an empty draft — try rephrasing the brief.";
    }
  } else {
    outcome = "failed";
    error = runFailureMessage(run, "copilot", analystKeyEnvName());
  }

  // Eval log — one row per draft request: the brief, a preview, tokens, model.
  if (admin) {
    const { data: profile } = await supabase
      .from("staff_profiles")
      .select("display_name")
      .eq("id", user.id)
      .maybeSingle();
    await admin.from("audit_log").insert({
      business_id: membership.business_id,
      actor: profile?.display_name ?? user.id,
      action: "copilot.draft",
      target_id: membership.business_id,
      payload_snapshot: {
        model,
        channel,
        tone,
        goal: goal.slice(0, 200),
        segment: input.segmentName.slice(0, 120),
        has_offer: !!input.offerLabel,
        // How many versions actually came back — a run that produced one is a
        // separator the model ignored, and that shows up here before the shop
        // notices it has nothing to choose between.
        variants: drafts.length,
        draft_preview: (drafts[0]?.body ?? "").slice(0, 200),
        ...(run.ok
          ? { input_tokens: run.input_tokens, output_tokens: run.output_tokens }
          : { error_kind: run.kind, error_detail: run.message }),
      },
      outcome,
    });
  }

  if (outcome === "failed") return { ok: false, error };
  return { ok: true, drafts };
}
