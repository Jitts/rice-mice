import { createClient } from "@/lib/supabase/server";
import { DashboardShell } from "@/components/DashboardShell";
import { brandLine, withBusinessDefaults } from "@/lib/business";
import { withRuleDefaults } from "@/lib/marketing";
import { STAFF_ROLE_ID } from "@/lib/permissions";
import type { StaffAccess } from "@/components/StaffContext";

type ProfileRow = {
  id: string;
  display_name: string;
  roles: { name: string; permissions: string[] } | null;
};

// Resolves (and on first login, creates) the signed-in staff member's
// profile + role so every dashboard page knows who is acting and what
// they're allowed to do. Also loads the business identity for the brand.
export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const [
    {
      data: { user },
    },
    { data: businessRow },
  ] = await Promise.all([
    supabase.auth.getUser(),
    supabase.from("business_settings").select("*").maybeSingle(),
  ]);

  let access: StaffAccess = { profile: null, roleName: null, permissions: [] };
  if (user) {
    const { data } = await supabase
      .from("staff_profiles")
      .select("id, display_name, roles(name, permissions)")
      .eq("id", user.id)
      .maybeSingle();
    let row = data as ProfileRow | null;
    if (!row) {
      const prefix = user.email?.split("@")[0] || "Staff";
      const display = prefix.charAt(0).toUpperCase() + prefix.slice(1);
      // First login: provision with the default Staff role. ignoreDuplicates
      // makes a concurrent race harmless; the DB trigger prevents this
      // insert from carrying anything above Staff.
      const { data: created } = await supabase
        .from("staff_profiles")
        .upsert(
          { id: user.id, display_name: display, role_id: STAFF_ROLE_ID },
          { onConflict: "id", ignoreDuplicates: true },
        )
        .select("id, display_name, roles(name, permissions)")
        .maybeSingle();
      row =
        (created as ProfileRow | null) ??
        ({ id: user.id, display_name: display, roles: null } as ProfileRow);
    }
    access = {
      profile: { id: row.id, display_name: row.display_name },
      roleName: row.roles?.name ?? null,
      permissions: row.roles?.permissions ?? [],
    };
  }

  return (
    <DashboardShell
      access={access}
      brand={brandLine(withBusinessDefaults(businessRow))}
      rules={withRuleDefaults(businessRow)}
    >
      {children}
    </DashboardShell>
  );
}
