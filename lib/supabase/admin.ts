import { createClient as createSupabaseClient } from "@supabase/supabase-js";

// Service-role client — SERVER ONLY. The key lives exclusively in server env
// (SUPABASE_SERVICE_ROLE_KEY); importing this from a client component would
// return null in the browser and leak nothing, but don't: every use belongs
// in a server action that has already verified the caller's permission.
export function createAdminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!key || !url) return null;
  return createSupabaseClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
