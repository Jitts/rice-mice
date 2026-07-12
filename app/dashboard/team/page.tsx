import { createClient } from "@/lib/supabase/server";
import { TeamManager, type TeamMember } from "@/components/TeamManager";

export const dynamic = "force-dynamic";

export default async function TeamPage() {
  const supabase = await createClient();

  const [
    {
      data: { user },
    },
    { data: members },
  ] = await Promise.all([
    supabase.auth.getUser(),
    supabase
      .from("staff_profiles")
      .select("id, display_name, created_at")
      .order("created_at"),
  ]);

  return (
    <TeamManager
      members={(members ?? []) as TeamMember[]}
      ownId={user?.id ?? null}
      ownEmail={user?.email ?? null}
    />
  );
}
