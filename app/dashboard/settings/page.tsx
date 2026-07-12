import { createClient } from "@/lib/supabase/server";
import { withBusinessDefaults } from "@/lib/business";
import { SettingsManager } from "@/components/SettingsManager";
import type { RoleRow } from "@/lib/permissions";

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
  ] = await Promise.all([
    supabase.auth.getUser(),
    supabase.from("business_settings").select("*").maybeSingle(),
    supabase.from("roles").select("*").order("created_at"),
    supabase.from("staff_profiles").select("id, role_id"),
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

  return (
    <SettingsManager
      ownEmail={user?.email ?? null}
      profile={p ? { id: p.id, display_name: p.display_name } : null}
      permissions={p?.roles?.permissions ?? []}
      roleName={p?.roles?.name ?? null}
      initialBusiness={withBusinessDefaults(businessRow)}
      roles={(roles ?? []) as RoleRow[]}
      memberCounts={memberCounts}
    />
  );
}
