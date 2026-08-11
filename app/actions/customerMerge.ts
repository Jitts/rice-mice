"use server";

// Sprint 48: merging two customer records that are the same person.
//
// Sprint 46's importer refuses a receipt whose email names one customer and
// whose phone names another — 6 in a 330-receipt export, from shared handsets,
// counter typos and recycled numbers. Refusing was right (attaching the sale
// either way moves the wrong person's last visit and can flip their lifecycle
// stage) but it left no way forward. This is that way forward.
//
// The write itself is one call to merge_customers (migration 0025), because it
// has to be one transaction: repointing five tables and deleting a row over
// seven round trips would leave orders on one record and messages on another
// with no way to tell which half ran. Everything here is the part around it —
// permission, tenant fence, the plan, and the audit trail.
//
// Uses the service-role client, so every query carries an explicit business_id
// filter: that filter is the tenant boundary, not RLS.

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { planMerge, type MergeableCustomer, type MergePlan } from "@/lib/customerMerge";

// Every column planMerge reads, and no more.
const MERGE_COLUMNS =
  "id, business_id, created_at, first_name, last_name, phone, email, birthday, notes, tags, custom_fields, whatsapp_opt_in, email_opt_in, sms_opt_in, last_purchase_date, last_contacted_at, unsubscribe_token";

export type MergeCounts = { orders: number; messages: number; signups: number };

export type MergePreviewResult =
  | {
      ok: true;
      survivor: MergeableCustomer;
      absorbed: MergeableCustomer;
      plan: MergePlan;
      /** What the absorbed record brings with it. */
      counts: MergeCounts;
    }
  | { ok: false; error: string };

export type MergeResult =
  | { ok: true; survivorId: string; moved: MergeCounts }
  | { ok: false; error: string };

type Caller = { userId: string; businessId: string; displayName: string | null };

/**
 * Merge rides on the `customers` permission (decided 2026-08-11): it is an edit
 * to customer data, and a role trusted to change someone's contact details is
 * trusted to say two records are one person.
 */
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

/**
 * Reads both records, scoped to the caller's business.
 *
 * BOTH ids are fenced, not just the survivor: naming another tenant's customer
 * as the absorbed one is the whole attack, since that is the record whose
 * orders and messages get pulled across. 0025 checks this again in SQL — this
 * is the copy that lets the UI say something useful instead of throwing.
 */
async function loadPair(
  api: NonNullable<ReturnType<typeof createAdminClient>>,
  businessId: string,
  survivorId: string,
  absorbedId: string,
): Promise<{ survivor: MergeableCustomer; absorbed: MergeableCustomer } | null> {
  const { data } = await api
    .from("customers")
    .select(MERGE_COLUMNS)
    .eq("business_id", businessId)
    .in("id", [survivorId, absorbedId]);

  const rows = (data ?? []) as unknown as MergeableCustomer[];
  const survivor = rows.find((r) => r.id === survivorId);
  const absorbed = rows.find((r) => r.id === absorbedId);
  if (!survivor || !absorbed) return null;
  return { survivor, absorbed };
}

function validIds(a: unknown, b: unknown): boolean {
  return typeof a === "string" && a.length > 0 && typeof b === "string" && b.length > 0;
}

export async function previewMerge(
  survivorId: string,
  absorbedId: string,
): Promise<MergePreviewResult> {
  const gate = await requireCustomersCaller();
  if (!gate.ok) return gate;
  const { businessId } = gate.caller;

  if (!validIds(survivorId, absorbedId))
    return { ok: false, error: "Two customers weren't named" };

  const api = createAdminClient();
  if (!api)
    return { ok: false, error: "Merging isn't configured — SUPABASE_SERVICE_ROLE_KEY is missing" };

  const pair = await loadPair(api, businessId, survivorId, absorbedId);
  if (!pair) return { ok: false, error: "Those two customers aren't both yours" };

  const proposal = planMerge(pair.survivor, pair.absorbed);
  if (!proposal.ok) return { ok: false, error: proposal.reason };

  const [{ count: orders }, { count: messages }, { count: signups }] = await Promise.all([
    api
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("business_id", businessId)
      .eq("customer_id", absorbedId),
    api
      .from("engagement_logs")
      .select("id", { count: "exact", head: true })
      .eq("business_id", businessId)
      .eq("customer_id", absorbedId),
    api
      .from("signup_events")
      .select("id", { count: "exact", head: true })
      .eq("business_id", businessId)
      .eq("customer_id", absorbedId),
  ]);

  return {
    ok: true,
    survivor: pair.survivor,
    absorbed: pair.absorbed,
    plan: proposal.plan,
    counts: { orders: orders ?? 0, messages: messages ?? 0, signups: signups ?? 0 },
  };
}

export async function mergeCustomers(
  survivorId: string,
  absorbedId: string,
): Promise<MergeResult> {
  const gate = await requireCustomersCaller();
  if (!gate.ok) return gate;
  const { businessId } = gate.caller;

  if (!validIds(survivorId, absorbedId))
    return { ok: false, error: "Two customers weren't named" };
  if (survivorId === absorbedId)
    return { ok: false, error: "A customer can't be merged into themselves" };

  const api = createAdminClient();
  if (!api)
    return { ok: false, error: "Merging isn't configured — SUPABASE_SERVICE_ROLE_KEY is missing" };

  // The plan is recomputed here from the database rather than taken from the
  // client, for the same reason the importer re-parses the CSV: the confirm
  // screen's version is for the human to look at, never the authority.
  const pair = await loadPair(api, businessId, survivorId, absorbedId);
  if (!pair) return { ok: false, error: "Those two customers aren't both yours" };

  const proposal = planMerge(pair.survivor, pair.absorbed);
  if (!proposal.ok) return { ok: false, error: proposal.reason };

  // Snapshotted BEFORE the call, because the row is gone afterwards. This is
  // what keeps an inherited opt-in defensible: audit_log is append-only with no
  // delete policy, so the record of what the absorbed customer had actually
  // consented to outlives the customer row. The dead unsubscribe token goes in
  // too — anyone holding that link loses the ability to unsubscribe, and a
  // support request about it has to be answerable.
  const consentSnapshot = {
    id: pair.absorbed.id,
    whatsapp_opt_in: pair.absorbed.whatsapp_opt_in,
    email_opt_in: pair.absorbed.email_opt_in,
    sms_opt_in: pair.absorbed.sms_opt_in,
    unsubscribe_token: pair.absorbed.unsubscribe_token ?? null,
    email: pair.absorbed.email,
    phone: pair.absorbed.phone,
  };

  const { data, error } = await api.rpc("merge_customers", {
    p_business: businessId,
    p_survivor: survivorId,
    p_absorbed: absorbedId,
    p_fields: proposal.plan.fields,
  });
  if (error) return { ok: false, error: `The merge didn't run: ${error.message}` };

  const moved = (data ?? {}) as Record<string, number>;
  const counts: MergeCounts = {
    orders: moved.orders_moved ?? 0,
    messages: moved.engagement_logs_moved ?? 0,
    signups: moved.signup_events_moved ?? 0,
  };

  await api.from("audit_log").insert({
    business_id: businessId,
    actor: gate.caller.displayName ?? gate.caller.userId,
    action: "customers.merged",
    target_id: survivorId,
    payload_snapshot: {
      survivor_id: survivorId,
      absorbed: consentSnapshot,
      inherited_opt_ins: proposal.plan.inheritedOptIns,
      orders_moved: counts.orders,
      signup_events_moved: counts.signups,
      engagement_logs_moved: counts.messages,
      journey_runs_moved: moved.journey_runs_moved ?? 0,
      journey_runs_dropped: moved.journey_runs_dropped ?? 0,
      journey_actions_moved: moved.journey_actions_moved ?? 0,
    },
  });

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/customers");
  revalidatePath(`/dashboard/customers/${survivorId}`);
  return { ok: true, survivorId, moved: counts };
}
