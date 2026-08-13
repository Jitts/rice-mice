import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { OrderImportWizard } from "@/components/OrderImportWizard";
import { ImportHistory } from "@/components/ImportHistory";
import { can } from "@/lib/permissions";
import type { CatalogItem, ExistingCustomerRef } from "@/lib/orderImport";

export const dynamic = "force-dynamic";

export default async function OrderImportPage() {
  const supabase = await createClient();

  // Same gate the commit action enforces server-side: importing history writes
  // real sales records, so it needs customer AND order permissions. Self lookup
  // (RLS shows the whole roster, so filter to this user).
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

  if (!can(perms, "customers") || !can(perms, "orders"))
    return (
      <div className="max-w-4xl mx-auto space-y-3">
        <h1 className="font-heading text-2xl font-bold tracking-tight">
          Import order history
        </h1>
        <p className="text-muted-foreground">
          Importing past sales writes to both your customer records and your sales
          reports, so it needs customer and order permissions. Ask an owner if you need
          access.
        </p>
        <Link href="/dashboard" className="text-sm underline hover:text-foreground">
          Back to the dashboard
        </Link>
      </div>
    );

  // Match keys only — id/phone/email is enough to attach a receipt to a person
  // and nothing more of the customer record leaves the server.
  const [{ data: customers }, { data: items }, { data: refRows }, { data: batches }] =
    await Promise.all([
      supabase.from("customers").select("id, phone, email"),
      supabase.from("items").select("id, name"),
      supabase.from("orders").select("import_ref").not("import_ref", "is", null),
      supabase
        .from("import_batches")
        .select("id, filename, created_at, kind, created_count, updated_count")
        .order("created_at", { ascending: false })
        .limit(20),
    ]);

  const batchRows = (batches ?? []) as {
    id: string;
    filename: string;
    created_at: string;
    kind: "customers" | "orders";
    created_count: number | null;
    updated_count: number | null;
  }[];

  // Which order batches still have rows, so an already-undone import shows as
  // undone rather than offering a no-op button. Customer batches are counted on
  // their own page; here they are listed read-only.
  //
  // Asked as a COUNT per batch rather than fetching every order and tallying in
  // JS. That tally read all orders across all listed batches unbounded, so the
  // 1,000-row cap truncated it — and this is the read where truncation does the
  // most damage: a batch whose orders fell past the cap counted zero, rendered
  // as "Undone", and hid its own undo button, telling the user an import they
  // can still see had already been reversed. Found by running the shop at a cap
  // of 10 (Sprint 49). `head: true` returns the number and no rows, so it costs
  // one small query per batch and cannot truncate.
  const orderBatchIds = batchRows.filter((b) => b.kind === "orders").map((b) => b.id);
  const presentCounts = await Promise.all(
    orderBatchIds.map(async (id) => {
      const { count } = await supabase
        .from("orders")
        .select("id", { count: "exact", head: true })
        .eq("import_batch_id", id);
      return [id, count ?? 0] as const;
    }),
  );
  const present = new Map<string, number>(presentCounts);

  return (
    <div className="space-y-6">
      <OrderImportWizard
        existingCustomers={(customers ?? []) as ExistingCustomerRef[]}
        catalog={(items ?? []) as CatalogItem[]}
        existingRefs={(refRows ?? []).map((r) => r.import_ref as string)}
        customerCount={(customers ?? []).length}
      />
      <div className="max-w-4xl mx-auto">
        <ImportHistory
          kind="orders"
          batches={batchRows
            .filter((b) => b.kind === "orders")
            .map((b) => ({
              id: b.id,
              filename: b.filename,
              created_at: b.created_at,
              created_count: b.created_count ?? 0,
              updated_count: b.updated_count ?? 0,
              present: present.get(b.id) ?? 0,
            }))}
        />
      </div>
    </div>
  );
}
