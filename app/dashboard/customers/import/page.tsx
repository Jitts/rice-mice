import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { CustomerImportWizard } from "@/components/CustomerImportWizard";
import { ImportHistory } from "@/components/ImportHistory";
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
  const [{ data: customers }, { data: customFields }, { data: batches }] = await Promise.all([
    // import_batch_id rides along on the wizard's match-key query rather than
    // costing a second pass over the same table.
    supabase.from("customers").select("id, phone, email, import_batch_id"),
    supabase.from("custom_fields").select("key"),
    supabase
      .from("import_batches")
      .select("id, filename, created_at, created_count, updated_count")
      .eq("kind", "customers")
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  const rows = (customers ?? []) as (ExistingCustomer & {
    import_batch_id: string | null;
  })[];

  // How many of each batch's customers are still here — a batch whose rows are
  // gone shows as already undone rather than offering a no-op button.
  const present = new Map<string, number>();
  for (const r of rows) {
    if (!r.import_batch_id) continue;
    present.set(r.import_batch_id, (present.get(r.import_batch_id) ?? 0) + 1);
  }

  return (
    <div className="space-y-6">
      <CustomerImportWizard
        existingCustomers={rows}
        existingCustomKeys={(customFields ?? []).map((f) => f.key as string)}
      />
      <div className="max-w-4xl mx-auto">
        <ImportHistory
          batches={(batches ?? []).map((b) => ({
            id: b.id as string,
            filename: b.filename as string,
            created_at: b.created_at as string,
            created_count: (b.created_count as number) ?? 0,
            updated_count: (b.updated_count as number) ?? 0,
            present: present.get(b.id as string) ?? 0,
          }))}
        />
      </div>
    </div>
  );
}
