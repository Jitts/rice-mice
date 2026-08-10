"use server";

// Sprint 45: undoing a customer import.
//
// Scoped by BATCH, not by filename and not by a time window: every customer an
// import creates carries its import_batch_id (migration 0022), so "undo" means
// "remove the rows this run created". Importing the same file twice makes two
// batches and undoing one leaves the other alone. There is deliberately no
// age limit — what makes an import unsafe to reverse is entanglement, not time.
//
// Two things it will NOT do:
//  - Delete a customer who has since placed an order or been messaged. That is
//    real history the import didn't create, so those rows are kept and
//    reported rather than quietly destroyed.
//  - Revert rows the import UPDATED. import_batch_id marks created rows only,
//    and prior values were never recorded, so there is nothing to restore to.
//    The UI says so per batch instead of implying a full rollback.
//
// Uses the service-role client, so every query carries an explicit business_id
// filter: that filter is the tenant boundary, not RLS.

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export type UndoResult =
  | {
      ok: true;
      kind: "customers" | "orders";
      deleted: number;
      kept: number;
      keptReason: string | null;
    }
  | { ok: false; error: string };

// .in() goes into the query string, so large id lists must be chunked.
const ID_CHUNK = 200;

type Caller = { userId: string; businessId: string; displayName: string | null };

async function requireCustomersCaller(): Promise<
  { ok: true; caller: Caller } | { ok: false; error: string }
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in" };
  const [{ data: membership }, { data: profile }] = await Promise.all([
    supabase
      .from("memberships")
      .select("business_id, roles(permissions)")
      .eq("user_id", user.id)
      .maybeSingle(),
    supabase
      .from("staff_profiles")
      .select("display_name")
      .eq("id", user.id)
      .maybeSingle(),
  ]);
  const m = membership as {
    business_id: string;
    roles: { permissions: string[] } | null;
  } | null;
  const perms = m?.roles?.permissions ?? [];
  if (!m || (!perms.includes("*") && !perms.includes("customers")))
    return { ok: false, error: "Your role doesn't include customer management" };
  return {
    ok: true,
    caller: {
      userId: user.id,
      businessId: m.business_id,
      displayName: profile?.display_name ?? null,
    },
  };
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export async function undoImport(batchId: string): Promise<UndoResult> {
  const gate = await requireCustomersCaller();
  if (!gate.ok) return gate;
  const { businessId } = gate.caller;

  if (typeof batchId !== "string" || batchId.length === 0)
    return { ok: false, error: "No import was named" };

  const api = createAdminClient();
  if (!api)
    return { ok: false, error: "Undo isn't configured — SUPABASE_SERVICE_ROLE_KEY is missing" };

  // The batch must belong to the caller's business before anything is read
  // through it — batchId arrives from the client.
  const { data: batch } = await api
    .from("import_batches")
    .select("id, filename, kind")
    .eq("id", batchId)
    .eq("business_id", businessId)
    .maybeSingle();
  if (!batch) return { ok: false, error: "That import isn't one of yours" };

  if (batch.kind === "orders")
    return undoOrderImport(api, businessId, batchId, batch.filename as string, gate.caller);

  const { data: rows, error: rowsErr } = await api
    .from("customers")
    .select("id")
    .eq("import_batch_id", batchId)
    .eq("business_id", businessId);
  if (rowsErr) return { ok: false, error: "Could not read that import's customers" };

  const ids = (rows ?? []).map((r) => r.id as string);
  if (ids.length === 0)
    return { ok: true, kind: "customers", deleted: 0, kept: 0, keptReason: null };

  // Anyone who has transacted or been contacted since the import keeps their
  // record: that history is not ours to delete.
  const withOrders = new Set<string>();
  const withMessages = new Set<string>();
  for (const part of chunk(ids, ID_CHUNK)) {
    const [{ data: ordered }, { data: messaged }] = await Promise.all([
      api
        .from("orders")
        .select("customer_id")
        .eq("business_id", businessId)
        .in("customer_id", part),
      api
        .from("engagement_logs")
        .select("customer_id")
        .eq("business_id", businessId)
        .in("customer_id", part),
    ]);
    for (const o of ordered ?? []) if (o.customer_id) withOrders.add(o.customer_id as string);
    for (const e of messaged ?? []) if (e.customer_id) withMessages.add(e.customer_id as string);
  }

  const deletable = ids.filter((id) => !withOrders.has(id) && !withMessages.has(id));
  const keptCount = ids.length - deletable.length;
  const keptReason =
    keptCount === 0
      ? null
      : withOrders.size > 0 && withMessages.size > 0
        ? "they have orders or messages on record"
        : withOrders.size > 0
          ? "they have placed an order since"
          : "they have been messaged since";

  let deleted = 0;
  for (const part of chunk(deletable, ID_CHUNK)) {
    // signup_events has no ON DELETE CASCADE, so it goes first or the customer
    // delete fails on the foreign key. journey_runs/actions do cascade.
    const { error: seErr } = await api
      .from("signup_events")
      .delete()
      .eq("business_id", businessId)
      .in("customer_id", part);
    if (seErr) return { ok: false, error: `Undo stopped partway: ${seErr.message}` };

    const { data: gone, error: cErr } = await api
      .from("customers")
      .delete()
      .eq("business_id", businessId)
      .in("id", part)
      .select("id");
    if (cErr) return { ok: false, error: `Undo stopped partway: ${cErr.message}` };
    deleted += gone?.length ?? 0;
  }

  // Keep the batch row when customers survived, so the import stays visible
  // and its remaining rows keep their provenance. Drop it only when it is
  // genuinely empty — import_batch_id is ON DELETE SET NULL, so removing the
  // row early would strip the survivors' link to where they came from.
  if (keptCount === 0) {
    await api.from("import_batches").delete().eq("id", batchId).eq("business_id", businessId);
  }

  await api.from("audit_log").insert({
    business_id: businessId,
    actor: gate.caller.displayName ?? gate.caller.userId,
    action: "customers.import_undone",
    target_id: batchId,
    payload_snapshot: {
      filename: batch.filename,
      deleted,
      kept: keptCount,
      kept_reason: keptReason,
    },
  });

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/customers/import");
  return { ok: true, kind: "customers", deleted, kept: keptCount, keptReason };
}

// --- Order imports -------------------------------------------------------------
// Simpler than the customer case: order_items cascades from orders, and nothing
// else in the schema points at an order, so there is no entanglement to protect
// against — an imported order is only ever the import's own work.
//
// The one thing that needs care is customers.last_purchase_date. It was moved
// forward by the import and the previous value was never recorded, so it is
// RECOMPUTED from the orders that remain rather than restored from a snapshot.
// That gives the right answer whether the customer's real last visit predates
// the import, was rung up in the app since, or no longer exists at all.

async function undoOrderImport(
  api: NonNullable<ReturnType<typeof createAdminClient>>,
  businessId: string,
  batchId: string,
  filename: string,
  caller: Caller,
): Promise<UndoResult> {
  const { data: rows, error: rowsErr } = await api
    .from("orders")
    .select("id, customer_id")
    .eq("import_batch_id", batchId)
    .eq("business_id", businessId);
  if (rowsErr) return { ok: false, error: "Could not read that import's orders" };

  const ids = (rows ?? []).map((r) => r.id as string);
  const affected = [
    ...new Set(
      (rows ?? []).flatMap((r) => (r.customer_id ? [r.customer_id as string] : [])),
    ),
  ];
  if (ids.length === 0)
    return { ok: true, kind: "orders", deleted: 0, kept: 0, keptReason: null };

  let deleted = 0;
  for (const part of chunk(ids, ID_CHUNK)) {
    const { data: gone, error } = await api
      .from("orders")
      .delete()
      .eq("business_id", businessId)
      .in("id", part)
      .select("id");
    if (error) return { ok: false, error: `Undo stopped partway: ${error.message}` };
    deleted += gone?.length ?? 0;
  }

  for (const part of chunk(affected, ID_CHUNK)) {
    const { data: remaining } = await api
      .from("orders")
      .select("customer_id, created_at")
      .eq("business_id", businessId)
      .eq("status", "completed")
      .in("customer_id", part);
    const newest = new Map<string, string>();
    for (const o of remaining ?? []) {
      const cid = o.customer_id as string;
      const at = o.created_at as string;
      const held = newest.get(cid);
      if (!held || at > held) newest.set(cid, at);
    }
    for (const customerId of part)
      await api
        .from("customers")
        .update({ last_purchase_date: newest.get(customerId) ?? null })
        .eq("id", customerId)
        .eq("business_id", businessId);
  }

  await api.from("import_batches").delete().eq("id", batchId).eq("business_id", businessId);

  await api.from("audit_log").insert({
    business_id: businessId,
    actor: caller.displayName ?? caller.userId,
    action: "orders.import_undone",
    target_id: batchId,
    payload_snapshot: { filename, deleted, customers_recomputed: affected.length },
  });

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/customers/import");
  return { ok: true, kind: "orders", deleted, kept: 0, keptReason: null };
}
