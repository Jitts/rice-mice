"use server";

// Sprint 46: the commit step of order-history CSV import.
//
// Same contract as the customer import: the wizard's preview is for the human,
// never the authority. This action re-parses the raw CSV and re-runs the
// identical pure pipeline (lib/orderImport.ts) before writing, so a tampered
// preview payload cannot attach an order to a customer the file never named.
// The client supplies only which column means what, the match policy, and the
// shop's UTC offset.
//
// Uses the service-role client, so every query carries an explicit business_id
// filter: that filter is the tenant boundary, not RLS.

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseCsv } from "@/lib/csv";
import {
  parseOrderLines,
  groupIntoOrders,
  resolveOrders,
  summarizeOrders,
  buildItemIndex,
  matchItem,
  type CatalogItem,
  type ExistingCustomerRef,
  type OrderColumnMapping,
  type OrderImportSummary,
  type UnmatchedPolicy,
} from "@/lib/orderImport";
import { journeyCounts, type JourneyStage } from "@/lib/segments";
import { withRuleDefaults } from "@/lib/marketing";

export type OrderImportResult =
  | {
      ok: true;
      batchId: string;
      summary: OrderImportSummary;
      /** Sprint 48 — people this run added, all opted out. */
      customersCreated: number;
      // Null when the breakdown could not be computed — the done screen hides
      // the panel rather than rendering five zeros as if they were counted.
      stages: Record<JourneyStage, number> | null;
      // Set when the orders landed but a follow-up step didn't. The import is
      // still a success; this is what stops the UI reporting a clean run.
      warning: string | null;
    }
  | { ok: false; error: string };

const MAX_CSV_CHARS = 6_000_000;
// A line-item export runs several rows per order, so this ceiling is higher
// than the customer import's — 20,000 rows is roughly 8,000 receipts.
const MAX_ROWS = 20_000;
const WRITE_CHUNK = 200;
// The last_purchase_date pairs ride in an RPC's POST body, so unlike a `.in()`
// list the ceiling here is payload size, not URL length — hence far larger than
// WRITE_CHUNK. One café's import lands in a single call.
const LAST_PURCHASE_CHUNK = 1_000;

type Caller = { userId: string; businessId: string; displayName: string | null };

/**
 * Importing history writes real sales records, so it needs BOTH permissions:
 * `customers` because it attaches history to people, and `orders` because the
 * rows it creates land in the sales reports. Editing a tag shouldn't let
 * someone backdate a year of revenue.
 */
async function requireImportCaller(): Promise<
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
  const allowed =
    perms.includes("*") ||
    (perms.includes("customers") && perms.includes("orders"));
  if (!m || !allowed)
    return {
      ok: false,
      error: "Importing order history needs both customer and order permissions",
    };
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

export async function importOrders(input: {
  filename: string;
  csvText: string;
  mappings: OrderColumnMapping[];
  policy: UnmatchedPolicy;
  utcOffsetMinutes: number;
  /** Sprint 48: create the customers the file names who aren't on file yet. */
  createCustomers?: boolean;
}): Promise<OrderImportResult> {
  const gate = await requireImportCaller();
  if (!gate.ok) return gate;
  const { businessId } = gate.caller;

  if (typeof input.csvText !== "string" || input.csvText.trim() === "")
    return { ok: false, error: "That file looks empty" };
  if (input.csvText.length > MAX_CSV_CHARS)
    return { ok: false, error: "That file is too large — split it and import in parts" };
  if (!Array.isArray(input.mappings) || input.mappings.length === 0)
    return { ok: false, error: "No columns were mapped" };
  const policy: UnmatchedPolicy = input.policy === "unattached" ? "unattached" : "skip";
  const createCustomers = input.createCustomers === true;
  // Clamped to the real range of world timezones; anything outside it is a
  // tampered payload, not a shop.
  const offset =
    Number.isFinite(input.utcOffsetMinutes) &&
    Math.abs(input.utcOffsetMinutes) <= 14 * 60
      ? Math.trunc(input.utcOffsetMinutes)
      : 0;

  const api = createAdminClient();
  if (!api)
    return { ok: false, error: "Import isn't configured — SUPABASE_SERVICE_ROLE_KEY is missing" };

  // 1. Re-derive the orders from the file itself.
  const table = parseCsv(input.csvText);
  if (table.rows.length === 0) return { ok: false, error: "That file has no data rows" };
  if (table.rows.length > MAX_ROWS)
    return {
      ok: false,
      error: `That file has ${table.rows.length} rows — import up to ${MAX_ROWS} at a time`,
    };

  const lines = parseOrderLines(table, input.mappings);
  const { orders: drafts, errored } = groupIntoOrders(lines, offset);

  const [{ data: customerRefs, error: custErr }, { data: catalog }, { data: refRows }] =
    await Promise.all([
      api.from("customers").select("id, phone, email").eq("business_id", businessId),
      api.from("items").select("id, name").eq("business_id", businessId),
      api
        .from("orders")
        .select("import_ref")
        .eq("business_id", businessId)
        .not("import_ref", "is", null),
    ]);
  if (custErr) return { ok: false, error: "Could not read your existing customers" };

  const existing = (customerRefs ?? []) as ExistingCustomerRef[];
  const itemIndex = buildItemIndex((catalog ?? []) as CatalogItem[]);
  const existingRefs = (refRows ?? []).map((r) => r.import_ref as string);

  const { resolved, newCustomers } = resolveOrders(
    drafts,
    existing,
    existingRefs,
    policy,
    createCustomers,
  );
  const summary = summarizeOrders(resolved, errored, lines, itemIndex, newCustomers);

  const toCreate = resolved.flatMap(({ order, outcome }) =>
    outcome.kind === "create"
      ? [{ order, customerId: outcome.customerId, newCustomerKey: outcome.newCustomerKey }]
      : [],
  );
  if (toCreate.length === 0)
    return { ok: false, error: "Nothing in that file would be imported" };

  // 2. Open the batch, so every row written below is traceable to it and the
  // whole import can be undone as a unit.
  const { data: batch, error: batchErr } = await api
    .from("import_batches")
    .insert({
      business_id: businessId,
      kind: "orders",
      filename: input.filename.slice(0, 200),
      row_count: table.rows.length,
      created_by: gate.caller.displayName ?? gate.caller.userId,
    })
    .select("id")
    .single();
  if (batchErr || !batch) return { ok: false, error: "Could not start the import" };
  const batchId = batch.id as string;

  // 3. The people this file names who aren't on file yet (Sprint 48), before
  // the orders because the orders need their ids.
  //
  // CONSENT FLOOR: every opt-in is written false, explicitly, and there is no
  // input that could say otherwise — a POS export proves someone bought
  // something, never that they agreed to be messaged. This is red-team gate
  // item 5, and a bulk import is exactly that vector.
  //
  // created_at is their earliest receipt, not today: importing on the 11th
  // would otherwise stamp every one of them as signing up on the 11th, putting
  // a fake spike on the growth chart and making the `signed_up` criterion
  // useless on this data.
  const keyByEmail = new Map<string, string>();
  const keyByPhone = new Map<string, string>();
  for (const c of newCustomers) {
    if (c.email) keyByEmail.set(c.email, c.key);
    if (c.phone) keyByPhone.set(c.phone, c.key);
  }

  const createdIdByKey = new Map<string, string>();
  for (const part of chunk(newCustomers, WRITE_CHUNK)) {
    const { data: written, error } = await api
      .from("customers")
      .insert(
        part.map((c) => ({
          business_id: businessId,
          first_name: c.firstName,
          last_name: c.lastName,
          phone: c.phone,
          email: c.email,
          whatsapp_opt_in: false,
          email_opt_in: false,
          sms_opt_in: false,
          created_at: c.createdAt,
          import_batch_id: batchId,
        })),
      )
      .select("id, phone, email");
    if (error)
      return { ok: false, error: `Import failed partway: ${error.message}` };

    // Matched back by handle rather than by row order: a multi-row insert's
    // RETURNING order is not something to hang customer attribution on.
    for (const row of written ?? []) {
      const key =
        (row.email ? keyByEmail.get(row.email as string) : null) ??
        (row.phone ? keyByPhone.get(row.phone as string) : null);
      if (key) createdIdByKey.set(key, row.id as string);
    }

    // source = 'order_import' keeps "this person came from a receipt"
    // derivable without a new customer column, the same way Sprint 45's
    // 'csv_import' does.
    const events = part.flatMap((c) => {
      const id = createdIdByKey.get(c.key);
      return id
        ? [{ customer_id: id, source: "order_import", created_at: c.createdAt }]
        : [];
    });
    if (events.length > 0) {
      // Stamped here rather than upstream so the tenant fence is visible at the
      // query itself (tests/tenantIsolation.test.ts).
      const { error: seErr } = await api
        .from("signup_events")
        .insert(events.map((e) => ({ ...e, business_id: businessId })));
      if (seErr)
        return { ok: false, error: `Import failed partway: ${seErr.message}` };
    }
  }
  const customersCreated = createdIdByKey.size;

  // Every order now knows its customer, whether that customer was already on
  // file or was created a moment ago.
  const withCustomers = toCreate.map(({ order, customerId, newCustomerKey }) => ({
    order,
    customerId:
      customerId ?? (newCustomerKey ? (createdIdByKey.get(newCustomerKey) ?? null) : null),
  }));

  // 4. Orders, then their lines. The unique index on (business_id, import_ref)
  // is the real idempotency guard — the pre-read above is a preview
  // convenience, and two imports racing would still be caught here.
  let created = 0;
  const lastVisit = new Map<string, string>();

  for (const part of chunk(withCustomers, WRITE_CHUNK)) {
    const payload = part.map(({ order, customerId }) => ({
      customer_id: customerId,
      status: order.status,
      payment_method: order.paymentMethod,
      staff_name: order.staff,
      total_cents: order.totalCents,
      discount_cents: order.discountCents,
      created_at: order.at,
      import_ref: order.importRef,
      import_batch_id: batchId,
    }));
    // business_id is stamped here rather than upstream so the tenant fence is
    // visible at the query itself (tests/tenantIsolation.test.ts).
    const { data: written, error } = await api
      .from("orders")
      .insert(payload.map((p) => ({ ...p, business_id: businessId })))
      .select("id, import_ref");
    if (error) return { ok: false, error: `Import failed partway: ${error.message}` };

    const idByRef = new Map(
      (written ?? []).map((r) => [r.import_ref as string, r.id as string]),
    );
    created += written?.length ?? 0;

    const lineRows: Record<string, unknown>[] = [];
    for (const { order, customerId } of part) {
      const orderId = idByRef.get(order.importRef);
      if (!orderId) continue;
      for (const line of order.lines)
        lineRows.push({
          business_id: businessId,
          order_id: orderId,
          item_id: matchItem(line.itemName, itemIndex),
          item_name: line.itemName,
          unit_price_cents: line.unitPriceCents,
          quantity: line.quantity,
          created_at: order.at,
        });
      // Only completed orders count as a visit — buildProfiles ignores the
      // rest, so last_purchase_date has to agree with it or the Customers list
      // and the segment engine would disagree about the same person.
      if (customerId && order.status === "completed") {
        const seen = lastVisit.get(customerId);
        if (!seen || order.at > seen) lastVisit.set(customerId, order.at);
      }
    }

    for (const linePart of chunk(lineRows, WRITE_CHUNK)) {
      const { error: lineErr } = await api
        .from("order_items")
        .insert(linePart.map((l) => ({ ...l, business_id: businessId })));
      if (lineErr)
        return { ok: false, error: `Import failed partway: ${lineErr.message}` };
    }
  }

  // 5. last_purchase_date, only ever moved FORWARD. An import of old history
  // must not rewind someone whose most recent visit was rung up in the app.
  //
  // The forward-only rule lives in the RPC's WHERE clause (migration 0024), not
  // in a read-then-write here. One round trip per chunk instead of one per
  // customer — 129 customers used to mean ~127 sequential updates and most of a
  // 40s import — and no window between reading someone's current value and
  // writing over it. A failure is deliberately not fatal: the orders are already
  // committed at this point, so reporting the whole import as failed would be a
  // lie, and the batch stays undoable either way.
  //
  // Not fatal is not the same as not reported. The error is kept and surfaced,
  // because the silent version of this is the dangerous one: every screen would
  // show a clean import while last-visit dates stayed wrong, and "at risk" is
  // computed from exactly that field.
  let lastVisitError: string | null = null;
  for (const part of chunk([...lastVisit], LAST_PURCHASE_CHUNK)) {
    const { error } = await api.rpc("import_touch_last_purchase", {
      p_business: businessId,
      p_updates: part.map(([customer_id, visited_at]) => ({
        customer_id,
        visited_at,
      })),
    });
    if (error) {
      lastVisitError = error.message;
      break; // later chunks would fail the same way
    }
  }

  await api
    .from("import_batches")
    .update({
      created_count: created,
      // Nobody's last visit moved if the pass above failed, so don't record
      // that it did — this count is what the undo panel shows back to the user.
      updated_count: lastVisitError ? 0 : lastVisit.size,
      skipped_count:
        summary.skipAlreadyImported +
        summary.skipDuplicateInFile +
        summary.skipNoCustomerMatch +
        summary.skipWalkIn +
        summary.skipNoNameToCreate +
        summary.skipAmbiguousIdentity +
        summary.conflicts,
    })
    .eq("id", batchId)
    .eq("business_id", businessId);

  await api.from("audit_log").insert({
    business_id: businessId,
    actor: gate.caller.displayName ?? gate.caller.userId,
    action: "orders.imported",
    target_id: batchId,
    payload_snapshot: {
      filename: input.filename.slice(0, 200),
      rows: table.rows.length,
      orders_created: created,
      attached: summary.attachedToCustomers,
      // Everyone counted here was written opted out of every channel.
      customers_created: customersCreated,
      create_customers: createCustomers,
      unattached: summary.unattached,
      conflicts: summary.conflicts,
      no_name_to_create: summary.skipNoNameToCreate,
      ambiguous_identity: summary.skipAmbiguousIdentity,
      already_imported: summary.skipAlreadyImported,
      row_errors: summary.rowErrors,
      revenue_cents: summary.revenueCents,
      policy,
      utc_offset_minutes: offset,
      // Written whether or not it happened, so the audit trail is the place you
      // can tell a clean import from a partial one after the fact.
      last_visit_updated: lastVisitError ? 0 : lastVisit.size,
      last_visit_error: lastVisitError,
    },
  });

  // 6. The real stage breakdown, recomputed from what is now in the database —
  // this is the number that tells the café the history actually landed, so it
  // is measured rather than projected from the file. Null if it couldn't be
  // read; the done screen then shows nothing instead of five zeros.
  const stages = await currentStages(api, businessId);

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/customers/import");
  return {
    ok: true,
    batchId,
    summary: { ...summary, create: created, newCustomers: customersCreated },
    customersCreated,
    stages,
    warning: lastVisitError
      ? `The orders were imported, but their customers' last-visit dates could not be updated (${lastVisitError}). Spend and order counts are correct; lifecycle stages and the at-risk list may be wrong until this is sorted out. Undoing this import and running it again is safe.`
      : null,
  };
}

type AdminClient = NonNullable<ReturnType<typeof createAdminClient>>;

// Stage counts come from a grouped aggregate (migration 0024), not from rebuilt
// profiles: this used to select every customer, every order and every order LINE
// for the business to render five numbers, which grew with the shop's whole
// history rather than with the import. `stageOf` still owns the thresholds — the
// RPC returns only the two fields it reads, one row per customer.
type VisitAggregate = {
  order_count: number | string;
  last_visit: string | null;
};

async function currentStages(
  api: AdminClient,
  businessId: string,
): Promise<Record<JourneyStage, number> | null> {
  const [{ data: visits, error }, { data: business }] = await Promise.all([
    api.rpc("customer_visit_aggregate", { p_business: businessId }),
    api.from("businesses").select("*").eq("id", businessId).maybeSingle(),
  ]);
  // A failed read is NOT an empty shop. Falling through to `visits ?? []` would
  // render "New 0 · Active 0 · Loyal 0 · At risk 0 · Churned 0" under a heading
  // that promises these were counted from the database — a confident wrong
  // answer where no answer belongs. The caller hides the panel instead.
  if (error || !visits) return null;
  // count() is a bigint, which some client versions hand back as a string.
  return journeyCounts(
    (visits as VisitAggregate[]).map((v) => ({
      orderCount: Number(v.order_count),
      lastVisit: v.last_visit,
    })),
    withRuleDefaults(business),
  );
}
