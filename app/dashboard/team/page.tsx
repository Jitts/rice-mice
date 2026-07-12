import { createClient } from "@/lib/supabase/server";
import { TeamManager, type TeamMember } from "@/components/TeamManager";
import type { RoleRow } from "@/lib/permissions";

export const dynamic = "force-dynamic";

export default async function TeamPage() {
  const supabase = await createClient();

  const [
    {
      data: { user },
    },
    { data: members },
    { data: roles },
  ] = await Promise.all([
    supabase.auth.getUser(),
    supabase
      .from("staff_profiles")
      .select("id, display_name, created_at, role_id, roles(name)")
      .order("created_at"),
    supabase.from("roles").select("*").order("created_at"),
  ]);

  const own = (members ?? []).find((m) => m.id === user?.id) as
    | (TeamMember & { roles: { name: string } | null })
    | undefined;
  const { data: ownRole } = own?.role_id
    ? await supabase.from("roles").select("permissions").eq("id", own.role_id).maybeSingle()
    : { data: null };

  return (
    <TeamManager
      members={(members ?? []) as unknown as TeamMember[]}
      roles={(roles ?? []) as RoleRow[]}
      callerPermissions={ownRole?.permissions ?? []}
      ownId={user?.id ?? null}
      ownEmail={user?.email ?? null}
    />
  );
}
