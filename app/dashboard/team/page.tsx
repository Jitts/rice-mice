import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { can, type RoleRow } from "@/lib/permissions";
import {
  TeamManager,
  type AccountInfo,
  type TeamMember,
} from "@/components/TeamManager";

export const dynamic = "force-dynamic";

type MembershipRow = {
  id: string;
  user_id: string;
  role_id: string | null;
  created_at: string;
  roles: { name: string } | null;
};

export default async function TeamPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [
    { data: membershipRows },
    { data: profiles },
    { data: roles },
    { data: myMembership },
  ] = await Promise.all([
    // RLS scopes both of these to the caller's business.
    supabase
      .from("memberships")
      .select("id, user_id, role_id, created_at, roles(name)")
      .order("created_at"),
    supabase.from("staff_profiles").select("id, display_name"),
    supabase.from("roles").select("*").order("created_at"),
    // Self, not the roster.
    supabase
      .from("memberships")
      .select("roles(permissions)")
      .eq("user_id", user?.id ?? "")
      .maybeSingle(),
  ]);

  const callerPermissions: string[] =
    (myMembership as { roles: { permissions: string[] } | null } | null)?.roles
      ?.permissions ?? [];

  const nameById = new Map(
    (profiles ?? []).map((p) => [p.id, p.display_name as string]),
  );
  // memberships→roles is many-to-one; PostgREST returns an object (the
  // generated type guesses an array).
  const members: TeamMember[] = (
    (membershipRows ?? []) as unknown as MembershipRow[]
  ).map(
    (m) => ({
      id: m.user_id,
      membership_id: m.id,
      display_name: nameById.get(m.user_id) ?? "Unnamed",
      created_at: m.created_at,
      role_id: m.role_id,
      roles: m.roles,
    }),
  );

  // Emails + active status come from the auth admin API — server-side only,
  // only for team-permission holders, and only for THIS business's roster.
  const adminReady = !!process.env.SUPABASE_SERVICE_ROLE_KEY;
  const accounts: Record<string, AccountInfo> = {};
  if (adminReady && can(callerPermissions, "team")) {
    const rosterIds = new Set(members.map((m) => m.id));
    const adminApi = createAdminClient();
    const { data: list } = (await adminApi?.auth.admin.listUsers()) ?? {};
    const now = Date.now();
    for (const u of list?.users ?? []) {
      if (!rosterIds.has(u.id)) continue;
      const bannedUntil = (u as { banned_until?: string | null }).banned_until;
      accounts[u.id] = {
        email: u.email ?? null,
        banned: !!bannedUntil && new Date(bannedUntil).getTime() > now,
      };
    }
  }

  return (
    <TeamManager
      members={members}
      roles={(roles ?? []) as RoleRow[]}
      callerPermissions={callerPermissions}
      accounts={accounts}
      adminReady={adminReady}
      ownId={user?.id ?? null}
      ownEmail={user?.email ?? null}
    />
  );
}
