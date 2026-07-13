// SERVER ONLY — resolves the signed-in caller's business. v1 keeps one
// business per user (memberships has a unique user_id), so maybeSingle is
// exact. Returns null for anon callers and members-of-nothing.

import { createClient } from "@/lib/supabase/server";

export async function callerBusinessId(): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase
    .from("memberships")
    .select("business_id")
    .eq("user_id", user.id)
    .maybeSingle();
  return data?.business_id ?? null;
}
