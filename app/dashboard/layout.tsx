import { createClient } from "@/lib/supabase/server";
import { DashboardShell } from "@/components/DashboardShell";
import type { StaffProfile } from "@/components/StaffContext";

// Resolves (and on first login, creates) the signed-in staff member's profile
// so every dashboard page can stamp actions with a real identity instead of a
// free-typed name.
export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let profile: StaffProfile | null = null;
  if (user) {
    const { data } = await supabase
      .from("staff_profiles")
      .select("id, display_name")
      .eq("id", user.id)
      .maybeSingle();
    profile = data;
    if (!profile) {
      const prefix = user.email?.split("@")[0] || "Staff";
      const display = prefix.charAt(0).toUpperCase() + prefix.slice(1);
      // ignoreDuplicates makes a concurrent first-login race harmless.
      const { data: created } = await supabase
        .from("staff_profiles")
        .upsert(
          { id: user.id, display_name: display },
          { onConflict: "id", ignoreDuplicates: true },
        )
        .select("id, display_name")
        .maybeSingle();
      profile = created ?? { id: user.id, display_name: display };
    }
  }

  return <DashboardShell profile={profile}>{children}</DashboardShell>;
}
