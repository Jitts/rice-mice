"use server";

// Sprint 45: the commit step of customer CSV import.
//
// The wizard previews an import in the browser, but that preview is never the
// authority. This action re-parses the raw CSV text and re-runs the identical
// pure pipeline (lib/customerImport.ts) before writing a row, so a tampered
// preview payload cannot smuggle in an opt-in the file never contained.
// Consent is DERIVED here from the file — it is never accepted from the client
// in any form. The client supplies only which column means what.
//
// Uses the service-role client, so every query carries an explicit business_id
// filter: that filter is the tenant boundary, not RLS.

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { readComplete } from "@/lib/supabase/readComplete";
import { parseCsv } from "@/lib/csv";
import {
  parseRows,
  resolveRows,
  summarize,
  type ColumnMapping,
  type ExistingCustomer,
  type ImportSummary,
  type MatchPolicy,
} from "@/lib/customerImport";

export type ImportResult =
  | { ok: true; batchId: string; summary: ImportSummary }
  | { ok: false; error: string };

// A server action body is capped by Next's limit; these keep the failure a
// clear message rather than a truncated parse. A café list past this size
// should be split, which the wizard tells the user.
const MAX_CSV_CHARS = 4_000_000;
const MAX_ROWS = 5_000;
// Postgres has a parameter ceiling per statement; wide custom-field rows hit it
// well before 5,000, so writes go in chunks.
const WRITE_CHUNK = 250;

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

export async function importCustomers(input: {
  filename: string;
  csvText: string;
  mappings: ColumnMapping[];
  policy: MatchPolicy;
}): Promise<ImportResult> {
  const gate = await requireCustomersCaller();
  if (!gate.ok) return gate;
  const { businessId } = gate.caller;

  if (typeof input.csvText !== "string" || input.csvText.trim() === "")
    return { ok: false, error: "That file looks empty" };
  if (input.csvText.length > MAX_CSV_CHARS)
    return { ok: false, error: "That file is too large — split it and import in parts" };
  if (!Array.isArray(input.mappings) || input.mappings.length === 0)
    return { ok: false, error: "No columns were mapped" };
  const policy: MatchPolicy = input.policy === "update" ? "update" : "skip";

  const api = createAdminClient();
  if (!api)
    return { ok: false, error: "Import isn't configured — SUPABASE_SERVICE_ROLE_KEY is missing" };

  // 1. Re-derive everything from the file itself.
  const table = parseCsv(input.csvText);
  if (table.rows.length === 0) return { ok: false, error: "That file has no data rows" };
  if (table.rows.length > MAX_ROWS)
    return {
      ok: false,
      error: `That file has ${table.rows.length} rows — import up to ${MAX_ROWS} at a time`,
    };

  const rows = parseRows(table, input.mappings);

  // Must be complete: a customer this read can't see is one the file won't
  // match, so a row that should update an existing person creates a duplicate
  // instead. Supabase caps reads at 1,000 rows without saying so (Sprint 49).
  const existingRead = await readComplete<ExistingCustomer>(
    "of your existing customers",
    api
      .from("customers")
      .select("id, phone, email", { count: "exact" })
      .eq("business_id", businessId),
  );
  if (!existingRead.ok) return { ok: false, error: existingRead.error };
  const existing = existingRead.rows;

  const resolved = resolveRows(rows, existing, policy);
  const summary = summarize(resolved, input.mappings);

  // 2. Create any custom fields this import introduces, so the imported values
  // are immediately usable as segment criteria.
  const wanted = input.mappings.flatMap((m) =>
    m.target.kind === "custom" ? [m.target] : [],
  );
  if (wanted.length > 0) {
    const { data: haveRaw } = await api
      .from("custom_fields")
      .select("key, sort_order")
      .eq("business_id", businessId);
    const have = new Set((haveRaw ?? []).map((f) => f.key as string));
    let nextOrder =
      Math.max(0, ...(haveRaw ?? []).map((f) => (f.sort_order as number) ?? 0)) + 1;
    const missing = wanted
      .filter((w) => !have.has(w.key))
      .map((w) => ({
        key: w.key,
        label: w.label,
        value_type: w.valueType,
        sort_order: nextOrder++,
      }));
    if (missing.length > 0) {
      // business_id is stamped here rather than upstream so the tenant fence is
      // visible at the query itself (tests/tenantIsolation.test.ts).
      const { error } = await api
        .from("custom_fields")
        .insert(missing.map((f) => ({ ...f, business_id: businessId })));
      if (error) return { ok: false, error: `Could not create custom fields: ${error.message}` };
    }
  }

  // 3. Open the batch, so every row written below is traceable to it.
  const { data: batch, error: batchErr } = await api
    .from("import_batches")
    .insert({
      business_id: businessId,
      kind: "customers",
      filename: input.filename.slice(0, 200),
      row_count: table.rows.length,
      created_by: gate.caller.displayName ?? gate.caller.userId,
    })
    .select("id")
    .single();
  if (batchErr || !batch) return { ok: false, error: "Could not start the import" };
  const batchId = batch.id as string;

  // 4. Writes. created_at carries the ORIGINAL signup date when the file had
  // one — without it every imported customer looks like they joined today,
  // which would break the "signed up" criterion and spike the growth chart.
  const toCreate = resolved.filter((r) => r.outcome.kind === "create");
  const toUpdate = resolved.filter((r) => r.outcome.kind === "update");

  let created = 0;
  const createdIds: string[] = [];
  for (const part of chunk(toCreate, WRITE_CHUNK)) {
    const payload = part.map(({ row }) => ({
      import_batch_id: batchId,
      first_name: row.firstName,
      last_name: row.lastName,
      phone: row.phone,
      email: row.email,
      whatsapp_opt_in: row.whatsappOptIn,
      email_opt_in: row.emailOptIn,
      sms_opt_in: row.smsOptIn,
      tags: row.tags,
      birthday: row.birthday,
      notes: row.notes,
      custom_fields: row.customFields,
      ...(row.signedUpAt ? { created_at: `${row.signedUpAt}T00:00:00Z` } : {}),
    }));
    // As above: business_id stamped at the query so the fence is greppable.
    const { data, error } = await api
      .from("customers")
      .insert(payload.map((p) => ({ ...p, business_id: businessId })))
      .select("id");
    if (error) return { ok: false, error: `Import failed partway: ${error.message}` };
    created += data?.length ?? 0;
    for (const r of data ?? []) createdIds.push(r.id as string);
  }

  // Updates touch attributes only. An opt-in is never downgraded to false by an
  // import: a file that omits a consent column must not silently unsubscribe
  // people who opted in through the app. Raising one still requires an
  // affirmative value in the file.
  let updated = 0;
  for (const { row, outcome } of toUpdate) {
    if (outcome.kind !== "update") continue;
    const patch: Record<string, unknown> = { custom_fields: row.customFields };
    if (row.firstName) patch.first_name = row.firstName;
    if (row.lastName) patch.last_name = row.lastName;
    if (row.phone) patch.phone = row.phone;
    if (row.email) patch.email = row.email;
    if (row.birthday) patch.birthday = row.birthday;
    if (row.notes) patch.notes = row.notes;
    if (row.tags.length > 0) patch.tags = row.tags;
    if (row.whatsappOptIn) patch.whatsapp_opt_in = true;
    if (row.emailOptIn) patch.email_opt_in = true;
    if (row.smsOptIn) patch.sms_opt_in = true;
    const { error } = await api
      .from("customers")
      .update(patch)
      .eq("id", outcome.customerId)
      .eq("business_id", businessId);
    if (!error) updated += 1;
  }

  // 5. A signup event per imported customer, so "how did this customer arrive"
  // stays answerable and the Customer 360 timeline has an origin.
  for (const part of chunk(createdIds, WRITE_CHUNK)) {
    await api.from("signup_events").insert(
      part.map((id) => ({
        business_id: businessId,
        customer_id: id,
        source: "csv_import",
      })),
    );
  }

  await api
    .from("import_batches")
    .update({
      created_count: created,
      updated_count: updated,
      skipped_count: summary.skip + summary.error,
    })
    .eq("id", batchId)
    .eq("business_id", businessId);

  await api.from("audit_log").insert({
    business_id: businessId,
    actor: gate.caller.displayName ?? gate.caller.userId,
    action: "customers.imported",
    target_id: batchId,
    payload_snapshot: {
      filename: input.filename.slice(0, 200),
      rows: table.rows.length,
      created,
      updated,
      skipped: summary.skip,
      errors: summary.error,
      opted_in: summary.optedIn,
      not_opted_in: summary.notOptedIn,
      consent_columns_mapped: summary.consentColumnsMapped,
      policy,
    },
  });

  revalidatePath("/dashboard");
  return { ok: true, batchId, summary: { ...summary, create: created, update: updated } };
}
