import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { can, type RoleRow } from "@/lib/permissions";
import {
  TeamManager,
  type AccountInfo,
  type TeamMember,
} from "@/components/TeamManager";

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

  const own = (members ?? []).find((m) => m.id === user?.id);
  const { data: ownRole } = own?.role_id
    ? await supabase.from("roles").select("permissions").eq("id", own.role_id).maybeSingle()
    : { data: null };
  const callerPermissions: string[] = ownRole?.permissions ?? [];

  // Emails + active status come from the auth admin API — server-side only,
  // and only for callers who hold the team permission.
  const adminReady = !!process.env.SUPABASE_SERVICE_ROLE_KEY;
  const accounts: Record<string, AccountInfo> = {};
  if (adminReady && can(callerPermissions, "team")) {
    const adminApi = createAdminClient();
    const { data: list } = (await adminApi?.auth.admin.listUsers()) ?? {};
    const now = Date.now();
    for (const u of list?.users ?? []) {
      const bannedUntil = (u as { banned_until?: string | null }).banned_until;
      accounts[u.id] = {
        email: u.email ?? null,
        banned: !!bannedUntil && new Date(bannedUntil).getTime() > now,
      };
    }
  }

  return (
    <TeamManager
      members={(members ?? []) as unknown as TeamMember[]}
      roles={(roles ?? []) as RoleRow[]}
      callerPermissions={callerPermissions}
      accounts={accounts}
      adminReady={adminReady}
      ownId={user?.id ?? null}
      ownEmail={user?.email ?? null}
    />
  );
}
