// Sprint 48: the pure core of merging two customer records.
//
// No I/O and no Supabase, for the same reason as lib/orderImport.ts: the
// confirm screen shows the user exactly what the survivor will look like, and
// the server action re-runs this identical function before writing. The
// browser's version is for the human; the server's re-run is the authority.
//
// The set-based mechanics — repointing orders, signup events, journey runs and
// the rest — live in migration 0025 because they need one transaction. What
// lives HERE is every rule about which value wins, so those rules have a single
// definition and cannot drift between SQL and app code. Same split as Sprint 47
// left between `customer_visit_aggregate` and `stageOf`.

export type MergeableCustomer = {
  id: string;
  business_id: string;
  created_at: string;
  first_name: string;
  last_name: string;
  phone: string | null;
  email: string | null;
  birthday: string | null;
  notes: string | null;
  tags: string[] | null;
  custom_fields: Record<string, unknown> | null;
  whatsapp_opt_in: boolean;
  email_opt_in: boolean;
  sms_opt_in: boolean;
  last_purchase_date: string | null;
  last_contacted_at: string | null;
  unsubscribe_token?: string | null;
};

/** Exactly the columns 0025's `p_fields` applies to the survivor. */
export type MergedFields = {
  first_name: string;
  last_name: string;
  phone: string | null;
  email: string | null;
  birthday: string | null;
  notes: string | null;
  created_at: string;
  last_purchase_date: string | null;
  last_contacted_at: string | null;
  tags: string[];
  custom_fields: Record<string, unknown>;
  whatsapp_opt_in: boolean;
  email_opt_in: boolean;
  sms_opt_in: boolean;
};

export type OptInChannel = "whatsapp_opt_in" | "email_opt_in" | "sms_opt_in";

export const OPT_IN_CHANNELS: OptInChannel[] = [
  "whatsapp_opt_in",
  "email_opt_in",
  "sms_opt_in",
];

export const OPT_IN_LABELS: Record<OptInChannel, string> = {
  whatsapp_opt_in: "WhatsApp",
  email_opt_in: "Email",
  sms_opt_in: "SMS",
};

export type MergePlan = {
  fields: MergedFields;
  /**
   * Opt-ins the survivor did not hold and inherits from the absorbed record.
   * Surfaced rather than buried: this is the one path in the app that turns an
   * opt-in on without the customer acting, so the person doing the merge sees
   * it before they confirm and the audit row records it after.
   */
  inheritedOptIns: OptInChannel[];
  /** Things the merge will do that aren't obvious from the field list. */
  notes: string[];
};

export type MergeRefusal = { ok: false; reason: string };
export type MergeProposal = { ok: true; plan: MergePlan };

function blank(v: string | null | undefined): boolean {
  return v == null || v.trim() === "";
}

/** Survivor's value unless it's blank, then the absorbed one. */
function preferSurvivor(a: string | null, b: string | null): string | null {
  if (!blank(a)) return a;
  if (!blank(b)) return b;
  return null;
}

function earliest(a: string, b: string): string {
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  if (!Number.isFinite(ta)) return b;
  if (!Number.isFinite(tb)) return a;
  return ta <= tb ? a : b;
}

function latest(a: string | null, b: string | null): string | null {
  if (a == null) return b;
  if (b == null) return a;
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  if (!Number.isFinite(ta)) return b;
  if (!Number.isFinite(tb)) return a;
  return ta >= tb ? a : b;
}

/**
 * True only when the source value is literally `true`.
 *
 * Deliberately not a truthiness check. This is the single code path in the app
 * that can raise an opt-in without the customer acting, so it must be
 * impossible for a missing column, a blank, a string, or a `1` to become
 * consent here — the same floor the CSV import holds in `parseConsent`.
 * See tests/consent.test.ts, which asserts exactly this.
 */
function inheritsOptIn(survivor: boolean, absorbed: unknown): boolean {
  if (survivor === true) return true;
  return absorbed === true;
}

/**
 * Combines two notes fields. Neither is dropped: the absorbed customer's notes
 * are staff-written history about a real person, and losing them to a
 * housekeeping action is not a trade the user agreed to.
 */
function mergeNotes(a: string | null, b: string | null): string | null {
  const sa = blank(a) ? null : a!.trim();
  const sb = blank(b) ? null : b!.trim();
  if (!sa) return sb;
  if (!sb) return sa;
  if (sa === sb) return sa;
  return `${sa}\n\n${sb}`;
}

function mergeTags(a: string[] | null, b: string[] | null): string[] {
  const seen = new Map<string, string>();
  for (const tag of [...(a ?? []), ...(b ?? [])]) {
    const t = (tag ?? "").trim();
    if (!t) continue;
    // Case-insensitive dedupe, first spelling kept: "VIP" and "vip" are one tag
    // in every place the segment builder uses them.
    const key = t.toLowerCase();
    if (!seen.has(key)) seen.set(key, t);
  }
  return [...seen.values()];
}

/**
 * Survivor's keys win; the absorbed record fills gaps. A key the survivor has
 * with an empty value counts as a gap — an import that wrote "" for a missing
 * column shouldn't beat a real value on the other record.
 */
function mergeCustomFields(
  a: Record<string, unknown> | null,
  b: Record<string, unknown> | null,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...(b ?? {}) };
  for (const [k, v] of Object.entries(a ?? {})) {
    if (v === null || v === undefined || v === "") {
      if (!(k in out)) out[k] = v;
      continue;
    }
    out[k] = v;
  }
  return out;
}

/**
 * Works out what the survivor looks like after absorbing the other record, or
 * refuses with a reason.
 *
 * The business check is here as well as in 0025 rather than only in the SQL:
 * the confirm screen must never render a plan for a merge the database will
 * reject, and a caller that skipped the action would still hit the fence in the
 * function.
 */
export function planMerge(
  survivor: MergeableCustomer,
  absorbed: MergeableCustomer,
): MergeProposal | MergeRefusal {
  if (survivor.id === absorbed.id)
    return { ok: false, reason: "A customer can't be merged into themselves" };
  if (survivor.business_id !== absorbed.business_id)
    return { ok: false, reason: "Those two customers belong to different businesses" };

  const inheritedOptIns: OptInChannel[] = [];
  for (const channel of OPT_IN_CHANNELS)
    if (survivor[channel] !== true && absorbed[channel] === true)
      inheritedOptIns.push(channel);

  const fields: MergedFields = {
    first_name: blank(survivor.first_name) ? absorbed.first_name : survivor.first_name,
    // Not preferSurvivor: a one-word name legitimately leaves last_name empty,
    // and an empty string is a real value the column allows.
    last_name: blank(survivor.last_name) ? absorbed.last_name : survivor.last_name,
    // The reason merge exists at all is a receipt whose phone names one record
    // and whose email names another, so the survivor ends up holding both.
    phone: preferSurvivor(survivor.phone, absorbed.phone),
    email: preferSurvivor(survivor.email, absorbed.email),
    birthday: preferSurvivor(survivor.birthday, absorbed.birthday),
    notes: mergeNotes(survivor.notes, absorbed.notes),
    // Earliest, always. These are one person; the older record is when they
    // actually became a customer, and taking the later date would move them out
    // of past "new customers this month" reports they belonged in.
    created_at: earliest(survivor.created_at, absorbed.created_at),
    last_purchase_date: latest(survivor.last_purchase_date, absorbed.last_purchase_date),
    last_contacted_at: latest(survivor.last_contacted_at, absorbed.last_contacted_at),
    tags: mergeTags(survivor.tags, absorbed.tags),
    custom_fields: mergeCustomFields(survivor.custom_fields, absorbed.custom_fields),
    whatsapp_opt_in: inheritsOptIn(survivor.whatsapp_opt_in, absorbed.whatsapp_opt_in),
    email_opt_in: inheritsOptIn(survivor.email_opt_in, absorbed.email_opt_in),
    sms_opt_in: inheritsOptIn(survivor.sms_opt_in, absorbed.sms_opt_in),
  };

  const notes: string[] = [];
  if (fields.created_at !== survivor.created_at)
    notes.push("Member-since moves back to the older record's date.");
  if (!blank(survivor.phone) && !blank(absorbed.phone) && survivor.phone !== absorbed.phone)
    notes.push(`The other phone number (${absorbed.phone}) is dropped.`);
  if (!blank(survivor.email) && !blank(absorbed.email) && survivor.email !== absorbed.email)
    notes.push(`The other email (${absorbed.email}) is dropped.`);
  if (absorbed.unsubscribe_token)
    notes.push("The absorbed record's unsubscribe link stops working.");

  return { ok: true, plan: { fields, inheritedOptIns, notes } };
}
