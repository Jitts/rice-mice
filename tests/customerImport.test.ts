import { describe, it, expect } from "vitest";
import { parseCsv, sniffDelimiter } from "@/lib/csv";
import {
  autoMapColumns,
  inferDateOrder,
  parseConsent,
  parseDateValue,
  parseRows,
  resolveRows,
  summarize,
  type ExistingCustomer,
} from "@/lib/customerImport";

// Helper: CSV text → resolved rows, exercising the whole pure pipeline the way
// the wizard and the server action both call it.
function run(csv: string, existing: ExistingCustomer[] = [], policy: "skip" | "update" = "skip") {
  const table = parseCsv(csv);
  const mappings = autoMapColumns(table);
  const rows = parseRows(table, mappings);
  const resolved = resolveRows(rows, existing, policy);
  return { table, mappings, rows, resolved, summary: summarize(resolved, mappings) };
}

describe("CSV parsing", () => {
  it("keeps commas and newlines inside quoted cells", () => {
    const t = parseCsv('first_name,notes\nAmara,"Likes bowls, extra chilli\nregular"');
    expect(t.rows[0][1]).toBe("Likes bowls, extra chilli\nregular");
  });

  it("unescapes doubled quotes", () => {
    const t = parseCsv('first_name,notes\nAmara,"calls it ""the usual"""');
    expect(t.rows[0][1]).toBe('calls it "the usual"');
  });

  it("strips the BOM Excel writes, so the first header still matches", () => {
    const t = parseCsv("﻿first_name,phone\nAmara,+27821234567");
    expect(t.headers[0]).toBe("first_name");
  });

  it("handles CRLF line endings", () => {
    const t = parseCsv("first_name,phone\r\nAmara,+27821234567\r\n");
    expect(t.rows).toHaveLength(1);
    expect(t.rows[0][0]).toBe("Amara");
  });

  it("sniffs a semicolon-delimited export", () => {
    expect(sniffDelimiter("first_name;phone;email\n")).toBe(";");
    const t = parseCsv("first_name;phone\nAmara;+27821234567");
    expect(t.rows[0][1]).toBe("+27821234567");
  });

  it("pads short rows and drops blank trailing lines", () => {
    const t = parseCsv("a,b,c\n1,2\n\n\n");
    expect(t.rows).toEqual([["1", "2", ""]]);
  });
});

// --- The consent floor --------------------------------------------------------
// Red-team gate item 5 (consent bypass). A bulk import is the exact vector, so
// these assert the direction of failure: anything unrecognised means NOT opted
// in, never the reverse.

describe("consent floor", () => {
  it("treats an absent opt-in column as opted out for every channel", () => {
    const { rows, summary } = run("first_name,phone\nAmara,+27821234567");
    expect(rows[0].whatsappOptIn).toBe(false);
    expect(rows[0].emailOptIn).toBe(false);
    expect(rows[0].smsOptIn).toBe(false);
    expect(summary.consentColumnsMapped).toBe(false);
    expect(summary.optedIn).toBe(0);
    expect(summary.notOptedIn).toBe(1);
  });

  it("accepts only explicitly affirmative values", () => {
    for (const v of ["yes", "Yes", "Y", "TRUE ", "true", "1", "opted in", "subscribed"])
      expect(parseConsent(v)).toBe(true);
  });

  it("refuses ambiguous, empty, and negative values", () => {
    for (const v of ["", "  ", "1.0", "maybe", "unknown", "no", "n", "0", "false", "yes!", "pending"])
      expect(parseConsent(v)).toBe(false);
    expect(parseConsent(null)).toBe(false);
    expect(parseConsent(undefined)).toBe(false);
  });

  it("never opts a row in from a default when the cell is blank", () => {
    const { rows } = run(
      "first_name,phone,whatsapp_opt_in,email_opt_in\nAmara,+27821234567,,",
    );
    expect(rows[0].whatsappOptIn).toBe(false);
    expect(rows[0].emailOptIn).toBe(false);
  });

  it("opts in only the channel whose column says so", () => {
    const { rows } = run(
      "first_name,phone,email,whatsapp_opt_in,email_opt_in,sms_opt_in\n" +
        "Amara,+27821234567,a@b.com,yes,no,",
    );
    expect(rows[0].whatsappOptIn).toBe(true);
    expect(rows[0].emailOptIn).toBe(false);
    expect(rows[0].smsOptIn).toBe(false);
  });
});

describe("date handling", () => {
  it("infers day-first when a value's first part cannot be a month", () => {
    expect(inferDateOrder(["15/03/2024", "01/02/2024"])).toBe("dmy");
  });

  it("infers month-first when a value's second part cannot be a month", () => {
    expect(inferDateOrder(["03/15/2024", "01/02/2024"])).toBe("mdy");
  });

  it("falls back to day-first when the column is genuinely ambiguous", () => {
    expect(inferDateOrder(["01/02/2024", "03/04/2024"])).toBe("dmy");
  });

  it("reads ISO and named-month dates", () => {
    expect(parseDateValue("2024-03-15", "iso")).toBe("2024-03-15");
    expect(parseDateValue("15 Mar 2024", "dmy")).toBe("2024-03-15");
  });

  it("rejects impossible dates instead of rolling them over", () => {
    expect(parseDateValue("31/02/2024", "dmy")).toBeNull();
    expect(parseDateValue("2023-02-29", "iso")).toBeNull();
  });
});

describe("row parsing", () => {
  it("splits a single full-name column", () => {
    const { rows } = run("name,phone\nAmara Osei,+27821234567");
    expect(rows[0].firstName).toBe("Amara");
    expect(rows[0].lastName).toBe("Osei");
  });

  it("normalises phones so formatting differences still match", () => {
    const { rows } = run("first_name,phone\nAmara,+27 82 123-4567");
    expect(rows[0].phone).toBe("27821234567");
  });

  it("errors on an unusable phone rather than importing a broken one", () => {
    const { rows } = run("first_name,phone\nAmara,not-a-phone");
    expect(rows[0].errors.join()).toMatch(/Phone isn't a usable number/);
  });

  it("errors on an invalid email", () => {
    const { rows } = run("first_name,phone,email\nAmara,+27821234567,nope@");
    expect(rows[0].errors.join()).toMatch(/Email isn't valid/);
  });

  it("errors on a row with no way to reach or match the person", () => {
    const { rows } = run("first_name,last_name\nAmara,Osei");
    expect(rows[0].errors.join()).toMatch(/can't be contacted or matched/);
  });

  it("preserves the original signup date instead of stamping today", () => {
    const { rows } = run("first_name,phone,member_since\nAmara,+27821234567,2019-04-02");
    expect(rows[0].signedUpAt).toBe("2019-04-02");
  });

  it("rejects a signup date in the future", () => {
    const { rows } = run("first_name,phone,member_since\nAmara,+27821234567,2999-01-01");
    expect(rows[0].errors.join()).toMatch(/in the future/);
  });

  it("splits tags on pipes, commas and semicolons", () => {
    const { rows } = run('first_name,phone,tags\nAmara,+27821234567,"vip | regular;lunch"');
    expect(rows[0].tags).toEqual(["vip", "regular", "lunch"]);
  });

  it("offers unknown columns as typed custom fields", () => {
    const { summary, rows } = run(
      "first_name,phone,Membership No,Favourite Table\n" +
        "Amara,+27821234567,4471,Window",
    );
    const keys = summary.newCustomFields.map((f) => `${f.key}:${f.valueType}`);
    expect(keys).toContain("membership_no:number");
    expect(keys).toContain("favourite_table:text");
    expect(rows[0].customFields.membership_no).toBe(4471);
    expect(rows[0].customFields.favourite_table).toBe("Window");
  });
});

describe("duplicate resolution", () => {
  const csv =
    "first_name,phone,email\n" +
    "Amara,+27821234567,amara@example.com\n" +
    "Sipho,+27839876543,sipho@example.com";

  it("creates when nothing matches", () => {
    const { resolved } = run(csv);
    expect(resolved.map((r) => r.outcome.kind)).toEqual(["create", "create"]);
  });

  it("matches an existing customer on phone despite different formatting", () => {
    const existing: ExistingCustomer[] = [
      { id: "c1", phone: "+27 82 123 4567", email: null },
    ];
    const { resolved } = run(csv, existing);
    expect(resolved[0].outcome).toEqual({ kind: "skip", reason: "matches_existing" });
    expect(resolved[1].outcome.kind).toBe("create");
  });

  it("matches on email case-insensitively and can update instead of skip", () => {
    const existing: ExistingCustomer[] = [
      { id: "c1", phone: null, email: "AMARA@example.com" },
    ];
    const { resolved } = run(csv, existing, "update");
    expect(resolved[0].outcome).toEqual({ kind: "update", customerId: "c1" });
  });

  it("skips a row duplicated later in the same file", () => {
    const dupe =
      "first_name,phone\n" +
      "Amara,+27821234567\n" +
      "Amara,+27 82 123 4567\n";
    const { resolved } = run(dupe);
    expect(resolved[0].outcome.kind).toBe("create");
    expect(resolved[1].outcome).toEqual({ kind: "skip", reason: "duplicate_in_file" });
  });

  it("never creates from a row that failed validation", () => {
    const { resolved } = run("first_name,phone\nAmara,not-a-phone");
    expect(resolved[0].outcome.kind).toBe("error");
  });

  it("re-importing the same file creates nothing the second time", () => {
    const first = run(csv);
    expect(first.summary.create).toBe(2);

    // Second run with those rows now in the database.
    const existing: ExistingCustomer[] = first.resolved.map((r, i) => ({
      id: `c${i}`,
      phone: r.row.phone,
      email: r.row.email,
    }));
    const second = run(csv, existing);
    expect(second.summary.create).toBe(0);
    expect(second.summary.skip).toBe(2);
  });
});

describe("preview summary", () => {
  it("reports what will land, including how many arrive opted out", () => {
    const { summary } = run(
      "first_name,phone,whatsapp_opt_in\n" +
        "Amara,+27821234567,yes\n" +
        "Sipho,+27839876543,no\n" +
        "Broken,not-a-phone,yes",
    );
    expect(summary.total).toBe(3);
    expect(summary.create).toBe(2);
    expect(summary.error).toBe(1);
    expect(summary.optedIn).toBe(1);
    expect(summary.notOptedIn).toBe(1);
    expect(summary.consentColumnsMapped).toBe(true);
  });
});
