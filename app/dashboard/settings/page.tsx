import { createClient } from "@/lib/supabase/server";
import { withBusinessDefaults } from "@/lib/business";
import { withRuleDefaults } from "@/lib/marketing";
import { listProviderViews } from "@/lib/providerConfig";
import { SettingsManager } from "@/components/SettingsManager";
import { can, type RoleRow } from "@/lib/permissions";
import { withLoyaltyDefaults, type Reward } from "@/lib/loyalty";
import {
  analystKeyPresent,
  analystModels,
  analystProviderLabel,
  resolveAnalystModel,
} from "@/lib/analystModel";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [
    { data: businessRow },
    { data: roles },
    { data: memberRows },
    { data: rewards },
    { data: myMembership },
  ] = await Promise.all([
    // RLS: exactly the caller's business.
    supabase.from("businesses").select("*").maybeSingle(),
    supabase.from("roles").select("*").order("created_at"),
    supabase.from("memberships").select("user_id, role_id"),
    supabase
      .from("rewards")
      .select("id, name, description, points_cost, benefit_type, benefit_value, active")
      .order("points_cost"),
    // Self, not the roster — RLS shows every membership in the business.
    supabase
      .from("memberships")
      .select("roles(name, permissions)")
      .eq("user_id", user?.id ?? "")
      .maybeSingle(),
  ]);

  const { data: profile } = user
    ? await supabase
        .from("staff_profiles")
        .select("id, display_name")
        .eq("id", user.id)
        .maybeSingle()
    : { data: null };

  const my = myMembership as {
    roles: { name: string; permissions: string[] } | null;
  } | null;
  const permissions = my?.roles?.permissions ?? [];

  const memberCounts: Record<string, number> = {};
  for (const m of memberRows ?? []) {
    if (m.role_id) memberCounts[m.role_id] = (memberCounts[m.role_id] ?? 0) + 1;
  }

  const biz = businessRow as
    | { id: string; slug: string; analyst_model: string | null }
    | null;
  // Even the MASKED provider views stay server-side unless the caller's role
  // includes the providers permission.
  const providers =
    can(permissions, "providers") && biz ? await listProviderViews(biz.id) : null;

  return (
    <SettingsManager
      ownEmail={user?.email ?? null}
      profile={profile ? { id: profile.id, display_name: profile.display_name } : null}
      permissions={permissions}
      roleName={my?.roles?.name ?? null}
      businessId={biz?.id ?? null}
      slug={biz?.slug ?? null}
      initialBusiness={withBusinessDefaults(businessRow)}
      initialRules={withRuleDefaults(businessRow)}
      initialLoyalty={withLoyaltyDefaults(businessRow)}
      roles={(roles ?? []) as RoleRow[]}
      memberCounts={memberCounts}
      providers={providers}
      rewards={(rewards ?? []) as Reward[]}
      analystModels={analystModels()}
      analystModel={resolveAnalystModel(biz?.analyst_model)}
      analystProviderLabel={analystProviderLabel()}
      analystConnected={analystKeyPresent()}
    />
  );
}
