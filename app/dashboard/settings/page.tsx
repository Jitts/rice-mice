import { createClient } from "@/lib/supabase/server";
import { withBusinessDefaults } from "@/lib/business";
import { withRuleDefaults } from "@/lib/marketing";
import { listProviderViews } from "@/lib/providerConfig";
import { SettingsManager } from "@/components/SettingsManager";
import { can, type RoleRow } from "@/lib/permissions";
import { withLoyaltyDefaults, type Reward } from "@/lib/loyalty";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const supabase = await createClient();

  const [
    {
      data: { user },
    },
    { data: businessRow },
    { data: roles },
    { data: members },
    { data: rewards },
  ] = await Promise.all([
    supabase.auth.getUser(),
    supabase.from("business_settings").select("*").maybeSingle(),
    supabase.from("roles").select("*").order("created_at"),
    supabase.from("staff_profiles").select("id, role_id"),
    supabase
      .from("rewards")
      .select("id, name, description, points_cost, benefit_type, benefit_value, active")
      .order("points_cost"),
  ]);

  const { data: profile } = user
    ? await supabase
        .from("staff_profiles")
        .select("id, display_name, roles(name, permissions)")
        .eq("id", user.id)
        .maybeSingle()
    : { data: null };

  const p = profile as
    | { id: string; display_name: string; roles: { name: string; permissions: string[] } | null }
    | null;

  const memberCounts: Record<string, number> = {};
  for (const m of members ?? []) {
    if (m.role_id) memberCounts[m.role_id] = (memberCounts[m.role_id] ?? 0) + 1;
  }

  const permissions = p?.roles?.permissions ?? [];
  // Even the MASKED provider views stay server-side unless the caller's role
  // includes the providers permission.
  const providers = can(permissions, "providers") ? await listProviderViews() : null;

  return (
    <SettingsManager
      ownEmail={user?.email ?? null}
      profile={p ? { id: p.id, display_name: p.display_name } : null}
      permissions={permissions}
      roleName={p?.roles?.name ?? null}
      initialBusiness={withBusinessDefaults(businessRow)}
      initialRules={withRuleDefaults(businessRow)}
      initialLoyalty={withLoyaltyDefaults(businessRow)}
      roles={(roles ?? []) as RoleRow[]}
      memberCounts={memberCounts}
      providers={providers}
      rewards={(rewards ?? []) as Reward[]}
    />
  );
}
