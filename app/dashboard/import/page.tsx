import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/permissions";

export const dynamic = "force-dynamic";

// Sprints 45 + 46 ship two importers that are almost always run in this order:
// the customer list, then the sales history that gives those customers a past.
// This page exists so the nav has one "Import" destination that says which one
// you want and why the order matters — a nav item pointing straight at the
// customer wizard is a dead end for someone holding a POS export.
export default async function ImportHubPage() {
  const supabase = await createClient();

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

  const canCustomers = can(perms, "customers");
  const canOrders = canCustomers && can(perms, "orders");

  // Counted rather than described: "you have 0 customers" is the one fact that
  // decides whether importing orders is worth starting.
  const [{ count: customerCount }, { count: orderCount }] = await Promise.all([
    supabase.from("customers").select("id", { count: "exact", head: true }),
    supabase.from("orders").select("id", { count: "exact", head: true }),
  ]);

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-bold tracking-tight">Import your data</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Bring an existing café across in two passes. Nothing is written until you&apos;ve
          seen a preview, and every import can be undone.
        </p>
      </div>

      <ol className="space-y-4">
        <Card
          step={1}
          title="Customer list"
          href="/dashboard/customers/import"
          allowed={canCustomers}
          denied="Needs the customer data permission."
          count={`${(customerCount ?? 0).toLocaleString()} customers so far`}
          body="Names, phones, emails and consent from your current system. Columns we don't
            recognise become custom fields you can build segments on. Nobody is marked as
            opted in unless the file clearly says so."
        />
        <Card
          step={2}
          title="Order history"
          href="/dashboard/orders/import"
          allowed={canOrders}
          denied="Needs the customer data and order pad permissions."
          count={`${(orderCount ?? 0).toLocaleString()} orders so far`}
          body="Past sales from your POS, matched to those customers by phone or email. This
            is what makes spend, favourite item, last visit and the lifecycle stages real —
            without it every imported customer sits in “New”."
        />
      </ol>
    </div>
  );
}

function Card({
  step,
  title,
  href,
  body,
  count,
  allowed,
  denied,
}: {
  step: number;
  title: string;
  href: string;
  body: string;
  count: string;
  allowed: boolean;
  denied: string;
}) {
  const inner = (
    <div className="flex gap-4">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-border text-sm font-semibold tabular-nums">
        {step}
      </span>
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-x-3">
          <h2 className="font-semibold">{title}</h2>
          <span className="text-xs text-muted-foreground">{count}</span>
        </div>
        <p className="text-sm text-muted-foreground mt-1">{body}</p>
        {!allowed && <p className="text-sm text-muted-foreground mt-2">{denied}</p>}
      </div>
    </div>
  );

  if (!allowed)
    return <li className="rounded-xl border border-border bg-card p-5 opacity-60">{inner}</li>;

  return (
    <li>
      <Link
        href={href}
        className="block rounded-xl border border-border bg-card p-5 hover:border-foreground/30 transition-colors"
      >
        {inner}
      </Link>
    </li>
  );
}
