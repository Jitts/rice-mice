import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

// Red-team gate item 6 (abuse/cost): a per-business daily cap on model calls.
// The meter is audit_log itself — every analyst.qa / copilot.draft exchange
// already writes a row, so counting today's rows for the business is the spend
// gauge. Enforced server-side in the actions, before the model is called, so a
// runaway client or a hostile tenant can't run up unbounded cost.
//
// Counted with the admin (service-role) client because audit_log SELECT is
// team-permission-gated under RLS; the count is scoped to the one business_id.

export const AI_DAILY_CAP = Number(process.env.RICE_AI_DAILY_CAP) || 200;

const AI_ACTIONS = ["analyst.qa", "copilot.draft"];

export async function aiCallsToday(
  admin: SupabaseClient,
  businessId: string,
): Promise<number> {
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  const { count } = await admin
    .from("audit_log")
    .select("id", { count: "exact", head: true })
    .eq("business_id", businessId)
    .in("action", AI_ACTIONS)
    .gte("created_at", start.toISOString());
  return count ?? 0;
}

// True when the business has room for another AI call today. Fails OPEN if the
// admin client isn't configured (dev without a service-role key) — the cap is a
// cost guard, not an auth control, so a missing meter shouldn't break the app.
export async function withinDailyAiCap(
  admin: SupabaseClient | null,
  businessId: string,
): Promise<boolean> {
  if (!admin) return true;
  return (await aiCallsToday(admin, businessId)) < AI_DAILY_CAP;
}
