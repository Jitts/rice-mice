import { createClient } from "@/lib/supabase/server";
import { withBusinessDefaults } from "@/lib/business";
import { SettingsManager } from "@/components/SettingsManager";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
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

  const { data: profile } = user
    ? await supabase
        .from("staff_profiles")
        .select("id, display_name")
        .eq("id", user.id)
        .maybeSingle()
    : { data: null };

  return (
    <SettingsManager
      ownEmail={user?.email ?? null}
      profile={profile}
      initialBusiness={withBusinessDefaults(businessRow)}
    />
  );
}
