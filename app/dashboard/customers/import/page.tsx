import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { CustomerImportWizard } from "@/components/CustomerImportWizard";
import { can } from "@/lib/permissions";
import type { ExistingCustomer } from "@/lib/customerImport";

export const dynamic = "force-dynamic";

export default async function CustomerImportPage() {
  const supabase = await createClient();

  // Same gate the commit action enforces server-side — this only keeps the
  // wizard out of view for a role that couldn't complete it. Self lookup (RLS
  // shows the whole roster, so filter to this user).
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: membershipRow } = user
    ? await supabase
        .from("memberships")
        .select("roles(permissions)")
        .eq("user_id", user.id)
        .maybeSingle()
    : { data: null };
  const perms = (membershipRow as { roles: { permissions: string[] } | null } | null)
    ?.roles?.permissions;

  if (!can(perms, "customers"))
    return (
      <div className="max-w-4xl mx-auto space-y-3">
        <h1 className="font-heading text-2xl font-bold tracking-tight">Import customers</h1>
        <p className="text-muted-foreground">
          Your role doesn&apos;t include customer management, so you can&apos;t import a
          customer list. Ask an owner if you need access.
        </p>
        <Link href="/dashboard" className="text-sm underline hover:text-foreground">
          Back to the dashboard
        </Link>
      </div>
    );

  // The wizard previews duplicate matching in the browser, so it needs the
  // match keys of customers already on file. Only id/phone/email are sent —
  // enough to match on, and nothing more of the customer record than that.
  const [{ data: customers }, { data: customFields }] = await Promise.all([
    supabase.from("customers").select("id, phone, email"),
    supabase.from("custom_fields").select("key"),
  ]);

  return (
    <CustomerImportWizard
      existingCustomers={(customers ?? []) as ExistingCustomer[]}
      existingCustomKeys={(customFields ?? []).map((f) => f.key as string)}
    />
  );
}
