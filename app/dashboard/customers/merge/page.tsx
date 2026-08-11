import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { MergeCustomers, type PickerCustomer } from "@/components/MergeCustomers";
import { can } from "@/lib/permissions";

export const dynamic = "force-dynamic";

export default async function MergeCustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ a?: string; b?: string }>;
}) {
  const { a, b } = await searchParams;
  const supabase = await createClient();

  // Same gate the actions enforce server-side. Self lookup, since RLS shows the
  // whole roster.
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
        <h1 className="font-heading text-2xl font-bold tracking-tight">Merge customers</h1>
        <p className="text-muted-foreground">
          Merging two records edits customer data, so it needs the customer permission.
          Ask an owner if you need access.
        </p>
        <Link href="/dashboard" className="text-sm underline hover:text-foreground">
          Back to the dashboard
        </Link>
      </div>
    );

  // Only what the picker needs to find someone. RLS already scopes this to the
  // caller's business; the actions re-fence both ids explicitly before writing.
  const { data: customers } = await supabase
    .from("customers")
    .select("id, first_name, last_name, phone, email")
    .order("first_name");

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-bold tracking-tight">Merge customers</h1>
        <p className="text-sm text-muted-foreground mt-1">
          When the same person is on file twice — two phone spellings, WhatsApp and email
          signed up separately — this folds them into one record. Their orders, messages
          and sign-up history all move to the record you keep.
        </p>
      </div>

      <MergeCustomers
        customers={(customers ?? []) as PickerCustomer[]}
        initialSurvivor={a}
        initialAbsorbed={b}
      />
    </div>
  );
}
