import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Lands here from a Supabase auth email link (password recovery today; also
// works for invites/magic links if those get added later) carrying a PKCE
// `code` — @supabase/ssr's browser/server clients both default to flowType
// "pkce", so the email link is a code to exchange, not a token in the URL
// hash. Exchanging it sets the real session cookies, then we continue to
// wherever the link was meant to land.
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const rawNext = searchParams.get("next") ?? "/dashboard";
  // Only ever redirect within this app — `next` rides in a URL, so treat it
  // as untrusted.
  const next = rawNext.startsWith("/") ? rawNext : "/dashboard";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(`${origin}${next}`);
  }

  return NextResponse.redirect(`${origin}/login?error=reset-link-invalid`);
}
