// Sprint 45: the pure core of customer CSV import — header detection, column
// mapping, per-row validation, the consent floor, and duplicate resolution.
//
// No I/O and no Supabase here: everything is a function of its arguments, so
// the wizard can preview an import in the browser and the server action can
// re-run the identical logic before writing a single row. That re-run is the
// point — the browser's preview is a convenience for the user, never the
// authority on what gets written.

import { columnValues, type CsvTable } from "@/lib/csv";
import { normalizePhone } from "@/lib/providers";
import type { CustomFieldValueType } from "@/lib/segments";

// --- Consent floor ------------------------------------------------------------
// An opt-in is true ONLY for an explicitly affirmative value. Everything else —
// a missing column, a blank cell, "1.0", "maybe", "unknown", anything
// unrecognised — resolves to false.
//
// This is deliberately NOT a general truthiness helper, and it must not be
// refactored into one. Importing a marketing list is exactly the shape of a
// consent bypass (red-team gate item 5, docs/RED_TEAM.md): the failure mode is
// silently messaging hundreds of people who never agreed, which is a PDPA/GDPR
// breach and a WhatsApp ban. The safe direction is always "not opted in", so
// widening this set is a consent decision, not a parsing convenience.
const AFFIRMATIVE = new Set([
  "yes",
  "y",
  "true",
  "t",
  "1",
  "optin",
  "opt in",
  "opt-in",
  "optedin",
  "opted in",
  "subscribed",
  "consented",
  "granted",
]);

export function parseConsent(raw: string | null | undefined): boolean {
  if (raw == null) return false;
  return AFFIRMATIVE.has(raw.trim().toLowerCase());
}

// --- Dates --------------------------------------------------------------------
// DD/MM vs MM/DD is unsolvable per row, so it is decided per COLUMN and shown
// in the wizard as a changeable picker. Anything that still doesn't parse is a
// row error with the raw value quoted, never a silently coerced date — a wrong
// birthday sends a birthday campaign on the wrong day.

export type DateOrder = "iso" | "dmy" | "mdy";

const ISO_RE = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/;
const NUMERIC_RE = /^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})$/;
const NAMED_RE = /^(\d{1,2})[\s\-]([A-Za-z]{3,})[\s\-,]*(\d{4})$/;

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

// Rejects impossible calendar dates (31 Feb, 30 Feb in a leap year, month 13)
// rather than letting Date roll them over into the next month.
function toIsoDate(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (
    dt.getUTCFullYear() !== y ||
    dt.getUTCMonth() !== m - 1 ||
    dt.getUTCDate() !== d
  )
    return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

// Uses the whole column: a value whose first part exceeds 12 can only be a day,
// which settles the order for every other row. Genuinely ambiguous columns fall
// back to day-first (most of the world) and the wizard exposes the choice.
export function inferDateOrder(values: string[]): DateOrder {
  let sawNumeric = false;
  let firstOver12 = false;
  let secondOver12 = false;
  for (const raw of values) {
    const v = raw.trim();
    if (!v || ISO_RE.test(v)) continue;
    const m = NUMERIC_RE.exec(v);
    if (!m) continue;
    sawNumeric = true;
    if (Number(m[1]) > 12) firstOver12 = true;
    if (Number(m[2]) > 12) secondOver12 = true;
  }
  if (!sawNumeric) return "iso";
  if (secondOver12 && !firstOver12) return "mdy";
  return "dmy";
}

export function parseDateValue(raw: string, order: DateOrder): string | null {
  const v = raw.trim();
  if (!v) return null;

  const iso = ISO_RE.exec(v);
  if (iso) return toIsoDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  const numeric = NUMERIC_RE.exec(v);
  if (numeric) {
    const a = Number(numeric[1]);
    const b = Number(numeric[2]);
    const y = Number(numeric[3]);
    return order === "mdy" ? toIsoDate(y, a, b) : toIsoDate(y, b, a);
  }

  const named = NAMED_RE.exec(v);
  if (named) {
    const month = MONTHS[named[2].slice(0, 3).toLowerCase()];
    if (!month) return null;
    return toIsoDate(Number(named[3]), month, Number(named[1]));
  }
  return null;
}

// --- Column mapping -----------------------------------------------------------

export type BuiltinTargetId =
  | "first_name"
  | "last_name"
  | "full_name"
  | "phone"
  | "email"
  | "whatsapp_opt_in"
  | "email_opt_in"
  | "sms_opt_in"
  | "tags"
  | "birthday"
  | "signed_up"
  | "notes";

export const BUILTIN_LABELS: Record<BuiltinTargetId, string> = {
  first_name: "First name",
  last_name: "Last name",
  full_name: "Full name (split)",
  phone: "Phone",
  email: "Email",
  whatsapp_opt_in: "WhatsApp opt-in",
  email_opt_in: "Email opt-in",
  sms_opt_in: "SMS opt-in",
  tags: "Tags",
  birthday: "Birthday",
  signed_up: "Signed up",
  notes: "Notes",
};

// Header spellings seen in real café exports. Matched against a normalised
// header (lowercased, non-alphanumerics stripped), so "Opt-In (WhatsApp)"
// and "opt in whatsapp" collapse to the same key.
const ALIASES: Record<BuiltinTargetId, string[]> = {
  first_name: ["firstname", "first", "givenname", "forename", "fname"],
  last_name: ["lastname", "last", "surname", "familyname", "lname"],
  full_name: ["name", "fullname", "customername", "customer", "contactname"],
  phone: [
    "phone", "phonenumber", "mobile", "mobilenumber", "mobileno", "cell",
    "cellphone", "contactnumber", "telephone", "tel", "whatsapp",
    "whatsappnumber", "msisdn",
  ],
  email: ["email", "emailaddress", "mail", "e-mail"],
  // The *consent* spellings matter more than most: these are what decide
  // whether a real export's opt-in column is found at all, and a missed column
  // silently imports everyone as opted out. The "…marketingconsent" forms are
  // Klaviyo's actual export headers.
  whatsapp_opt_in: [
    "whatsappoptin", "optinwhatsapp", "whatsappconsent", "whatsappmarketing",
    "whatsappmarketingconsent",
  ],
  email_opt_in: [
    "emailoptin", "optinemail", "emailconsent", "emailmarketing", "newsletter",
    "subscribed", "marketingoptin", "optin", "emailmarketingconsent",
    "emailsubscribestatus", "acceptsmarketing",
  ],
  sms_opt_in: [
    "smsoptin", "optinsms", "smsconsent", "smsmarketing", "textoptin",
    "smsmarketingconsent",
  ],
  tags: ["tags", "tag", "labels", "groups", "categories"],
  birthday: ["birthday", "birthdate", "dob", "dateofbirth"],
  signed_up: [
    "signedup", "signupdate", "signup", "joined", "joindate", "datejoined",
    "membersince", "createdat", "created", "registrationdate", "registered",
  ],
  notes: ["notes", "note", "comment", "comments", "remarks"],
};

// Longest aliases first so a specific header wins over a generic one — without
// this, "WhatsApp Opt-In" could match phone's bare "whatsapp".
const ALIAS_ORDER = (Object.keys(ALIASES) as BuiltinTargetId[]).sort(
  (a, b) =>
    Math.max(...ALIASES[b].map((s) => s.length)) -
    Math.max(...ALIASES[a].map((s) => s.length)),
);

export function normalizeHeader(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export type ColumnTarget =
  | { kind: "builtin"; id: BuiltinTargetId }
  | {
      kind: "custom";
      key: string;
      label: string;
      valueType: CustomFieldValueType;
    }
  | { kind: "ignore" };

export type ColumnMapping = {
  header: string;
  index: number;
  target: ColumnTarget;
  dateOrder?: DateOrder;
};

const BOOLEANISH = new Set([
  ...AFFIRMATIVE,
  "no", "n", "false", "f", "0", "optout", "opt out", "unsubscribed",
]);

// Guesses a custom field's value type from its data, narrowest first. Every
// value must fit, so one free-text cell in a numeric column keeps it text —
// the conservative direction, since a wrong type makes the criterion unusable.
export function guessValueType(values: string[]): CustomFieldValueType {
  const filled = values.map((v) => v.trim()).filter((v) => v !== "");
  if (filled.length === 0) return "text";
  if (filled.every((v) => BOOLEANISH.has(v.toLowerCase()))) return "boolean";
  if (filled.every((v) => v !== "" && Number.isFinite(Number(v)))) return "number";
  const order = inferDateOrder(filled);
  if (filled.every((v) => parseDateValue(v, order) !== null)) return "date";
  return "text";
}

function customKeyFor(header: string, taken: Set<string>): string {
  const base =
    header
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 48) || "field";
  let key = base;
  let n = 2;
  while (taken.has(key)) key = `${base}_${n++}`;
  taken.add(key);
  return key;
}

function needsDateOrder(target: ColumnTarget): boolean {
  if (target.kind === "builtin")
    return target.id === "birthday" || target.id === "signed_up";
  return target.kind === "custom" && target.valueType === "date";
}

// Unknown columns default to "create a custom field" rather than "ignore":
// the wizard shows that as a proposal the user confirms or switches off, which
// is what makes imported data segmentable without a second pass.
export function autoMapColumns(
  table: CsvTable,
  existingCustomKeys: string[] = [],
): ColumnMapping[] {
  const usedBuiltins = new Set<BuiltinTargetId>();
  const takenKeys = new Set(existingCustomKeys);

  return table.headers.map((header, index) => {
    const key = normalizeHeader(header);
    let target: ColumnTarget = { kind: "ignore" };

    if (key) {
      for (const id of ALIAS_ORDER) {
        if (usedBuiltins.has(id)) continue;
        if (key === normalizeHeader(id) || ALIASES[id].includes(key)) {
          target = { kind: "builtin", id };
          usedBuiltins.add(id);
          break;
        }
      }
      if (target.kind === "ignore") {
        const values = columnValues(table, index);
        target = {
          kind: "custom",
          key: customKeyFor(header, takenKeys),
          label: header.trim(),
          valueType: guessValueType(values),
        };
      }
    }

    const mapping: ColumnMapping = { header, index, target };
    if (needsDateOrder(target))
      mapping.dateOrder = inferDateOrder(columnValues(table, index));
    return mapping;
  });
}

// --- Row parsing --------------------------------------------------------------

export type ParsedRow = {
  rowNumber: number; // 1-based CSV line number, so an error names the line the user sees
  firstName: string;
  lastName: string;
  phone: string | null; // normalised digits — the match key
  email: string | null; // lowercased — the match key
  whatsappOptIn: boolean;
  emailOptIn: boolean;
  smsOptIn: boolean;
  tags: string[];
  birthday: string | null;
  signedUpAt: string | null; // null = fall back to the order history, then now()
  notes: string | null;
  customFields: Record<string, string | number | boolean>;
  errors: string[];
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function splitFullName(full: string): { first: string; last: string } {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first: "", last: "" };
  if (parts.length === 1) return { first: parts[0], last: "" };
  return { first: parts[0], last: parts.slice(1).join(" ") };
}

export function parseRows(
  table: CsvTable,
  mappings: ColumnMapping[],
): ParsedRow[] {
  const byBuiltin = new Map<BuiltinTargetId, ColumnMapping>();
  const customs: ColumnMapping[] = [];
  for (const m of mappings) {
    if (m.target.kind === "builtin") byBuiltin.set(m.target.id, m);
    else if (m.target.kind === "custom") customs.push(m);
  }

  const cellOf = (row: string[], id: BuiltinTargetId): string | null => {
    const m = byBuiltin.get(id);
    if (!m) return null;
    const v = (row[m.index] ?? "").trim();
    return v === "" ? null : v;
  };

  return table.rows.map((row, i) => {
    const errors: string[] = [];
    const rowNumber = i + 2; // +1 for 0-index, +1 for the header line

    let firstName = cellOf(row, "first_name") ?? "";
    let lastName = cellOf(row, "last_name") ?? "";
    const full = cellOf(row, "full_name");
    if (full && !firstName && !lastName) {
      const split = splitFullName(full);
      firstName = split.first;
      lastName = split.last;
    }

    const phoneRaw = cellOf(row, "phone");
    let phone: string | null = null;
    if (phoneRaw) {
      phone = normalizePhone(phoneRaw);
      if (!phone) errors.push(`Phone isn't a usable number: "${phoneRaw}"`);
    }

    const emailRaw = cellOf(row, "email");
    let email: string | null = null;
    if (emailRaw) {
      const candidate = emailRaw.toLowerCase();
      if (EMAIL_RE.test(candidate)) email = candidate;
      else errors.push(`Email isn't valid: "${emailRaw}"`);
    }

    // A row with neither handle can't be messaged and can't be de-duplicated,
    // which makes it dead weight in a CRM whose whole job is reaching people.
    if (!phone && !email && !phoneRaw && !emailRaw)
      errors.push("No phone or email — this row can't be contacted or matched");

    const birthdayRaw = cellOf(row, "birthday");
    let birthday: string | null = null;
    if (birthdayRaw) {
      const order = byBuiltin.get("birthday")?.dateOrder ?? "iso";
      birthday = parseDateValue(birthdayRaw, order);
      if (!birthday) errors.push(`Birthday isn't a date we can read: "${birthdayRaw}"`);
    }

    const signedUpRaw = cellOf(row, "signed_up");
    let signedUpAt: string | null = null;
    if (signedUpRaw) {
      const order = byBuiltin.get("signed_up")?.dateOrder ?? "iso";
      signedUpAt = parseDateValue(signedUpRaw, order);
      if (!signedUpAt)
        errors.push(`Signup date isn't a date we can read: "${signedUpRaw}"`);
      else if (new Date(`${signedUpAt}T00:00:00Z`).getTime() > Date.now())
        errors.push(`Signup date is in the future: "${signedUpRaw}"`);
    }

    const tagsRaw = cellOf(row, "tags");
    const tags = tagsRaw
      ? [...new Set(tagsRaw.split(/[|,;]/).map((t) => t.trim()).filter(Boolean))]
      : [];

    const customFields: Record<string, string | number | boolean> = {};
    for (const m of customs) {
      if (m.target.kind !== "custom") continue;
      const raw = (row[m.index] ?? "").trim();
      if (raw === "") continue;
      if (m.target.valueType === "number") {
        const n = Number(raw);
        if (Number.isFinite(n)) customFields[m.target.key] = n;
        else errors.push(`${m.target.label} isn't a number: "${raw}"`);
      } else if (m.target.valueType === "boolean") {
        customFields[m.target.key] = parseConsent(raw);
      } else if (m.target.valueType === "date") {
        const d = parseDateValue(raw, m.dateOrder ?? "iso");
        if (d) customFields[m.target.key] = d;
        else errors.push(`${m.target.label} isn't a date we can read: "${raw}"`);
      } else {
        customFields[m.target.key] = raw;
      }
    }

    return {
      rowNumber,
      firstName,
      lastName,
      phone,
      email,
      whatsappOptIn: parseConsent(cellOf(row, "whatsapp_opt_in")),
      emailOptIn: parseConsent(cellOf(row, "email_opt_in")),
      smsOptIn: parseConsent(cellOf(row, "sms_opt_in")),
      tags,
      birthday,
      signedUpAt,
      notes: cellOf(row, "notes"),
      customFields,
      errors,
    };
  });
}

// --- Duplicate resolution -----------------------------------------------------
// Two kinds of duplicate, and missing either one is how an import doubles a
// customer list: rows that match a customer already in the database, and rows
// that match an EARLIER ROW IN THE SAME FILE (exports with one line per order
// produce these constantly).

export type ExistingCustomer = {
  id: string;
  phone: string | null;
  email: string | null;
};

export type MatchPolicy = "skip" | "update";

export type RowOutcome =
  | { kind: "create" }
  | { kind: "update"; customerId: string }
  | { kind: "skip"; reason: "duplicate_in_file" | "matches_existing" }
  | { kind: "error"; errors: string[] };

export type ResolvedRow = { row: ParsedRow; outcome: RowOutcome };

export function resolveRows(
  rows: ParsedRow[],
  existing: ExistingCustomer[],
  policy: MatchPolicy,
): ResolvedRow[] {
  const byPhone = new Map<string, string>();
  const byEmail = new Map<string, string>();
  for (const c of existing) {
    const p = c.phone ? normalizePhone(c.phone) : null;
    if (p && !byPhone.has(p)) byPhone.set(p, c.id);
    const e = c.email?.trim().toLowerCase();
    if (e && !byEmail.has(e)) byEmail.set(e, c.id);
  }

  const seenPhone = new Set<string>();
  const seenEmail = new Set<string>();

  return rows.map((row) => {
    if (row.errors.length > 0)
      return { row, outcome: { kind: "error", errors: row.errors } as const };

    if (
      (row.phone && seenPhone.has(row.phone)) ||
      (row.email && seenEmail.has(row.email))
    )
      return {
        row,
        outcome: { kind: "skip", reason: "duplicate_in_file" } as const,
      };

    if (row.phone) seenPhone.add(row.phone);
    if (row.email) seenEmail.add(row.email);

    let existingId: string | null = null;
    if (row.phone) existingId = byPhone.get(row.phone) ?? null;
    if (!existingId && row.email) existingId = byEmail.get(row.email) ?? null;

    if (existingId)
      return policy === "update"
        ? { row, outcome: { kind: "update", customerId: existingId } as const }
        : {
            row,
            outcome: { kind: "skip", reason: "matches_existing" } as const,
          };

    return { row, outcome: { kind: "create" } as const };
  });
}

// --- Preview summary ----------------------------------------------------------

export type ImportSummary = {
  total: number;
  create: number;
  update: number;
  skip: number;
  error: number;
  optedIn: number;
  notOptedIn: number;
  consentColumnsMapped: boolean;
  newCustomFields: { key: string; label: string; valueType: CustomFieldValueType }[];
};

export function summarize(
  resolved: ResolvedRow[],
  mappings: ColumnMapping[],
): ImportSummary {
  const summary: ImportSummary = {
    total: resolved.length,
    create: 0,
    update: 0,
    skip: 0,
    error: 0,
    optedIn: 0,
    notOptedIn: 0,
    consentColumnsMapped: mappings.some(
      (m) =>
        m.target.kind === "builtin" &&
        (m.target.id === "whatsapp_opt_in" ||
          m.target.id === "email_opt_in" ||
          m.target.id === "sms_opt_in"),
    ),
    newCustomFields: mappings.flatMap((m) =>
      m.target.kind === "custom"
        ? [{ key: m.target.key, label: m.target.label, valueType: m.target.valueType }]
        : [],
    ),
  };

  for (const { row, outcome } of resolved) {
    summary[outcome.kind] += 1;
    if (outcome.kind === "error") continue;
    // Counted over rows that will actually land, so the number matches what the
    // café can message afterwards.
    if (outcome.kind === "skip") continue;
    if (row.whatsappOptIn || row.emailOptIn || row.smsOptIn) summary.optedIn += 1;
    else summary.notOptedIn += 1;
  }
  return summary;
}
