import { describe, it, expect } from "vitest";
import { channelDef } from "@/lib/campaigns";
import { parseConsent, parseRows, autoMapColumns } from "@/lib/customerImport";
import { parseCsv } from "@/lib/csv";
import {
  autoMapOrderColumns,
  parseOrderLines,
  groupIntoOrders,
  resolveOrders,
} from "@/lib/orderImport";
import { planMerge, type MergeableCustomer } from "@/lib/customerMerge";
import type { CustomerProfile } from "@/lib/segments";

// Red-team gate item 5 — consent bypass. Consent is enforced at the channel
// layer: channelDef(ch).address(profile) returns null unless the customer has
// BOTH opted in AND has contact info. Recipient lists are built by filtering on
// this, so a null here is a hard exclusion from every send path. These assert
// that no unsubscribed / uncontactable customer can ever resolve to an address.

// The address functions only read opt-in + contact fields; a partial profile is
// enough to exercise them.
function profile(p: Partial<CustomerProfile>): CustomerProfile {
  return p as CustomerProfile;
}

const whatsapp = channelDef("whatsapp");
const email = channelDef("email");
const sms = channelDef("sms");

describe("WhatsApp consent", () => {
  it("addresses an opted-in customer with a phone", () => {
    expect(whatsapp.address(profile({ whatsappOptIn: true, phone: "+6591234567" }))).toBe(
      "+6591234567",
    );
  });
  it("refuses a customer who did not opt in", () => {
    expect(whatsapp.address(profile({ whatsappOptIn: false, phone: "+6591234567" }))).toBeNull();
  });
  it("refuses an opted-in customer with no phone", () => {
    expect(whatsapp.address(profile({ whatsappOptIn: true, phone: null }))).toBeNull();
  });
});

describe("Email consent", () => {
  it("addresses an opted-in customer with an email", () => {
    expect(email.address(profile({ emailOptIn: true, email: "a@b.com" }))).toBe("a@b.com");
  });
  it("refuses a customer who did not opt in", () => {
    expect(email.address(profile({ emailOptIn: false, email: "a@b.com" }))).toBeNull();
  });
  it("refuses an opted-in customer with no email", () => {
    expect(email.address(profile({ emailOptIn: true, email: null }))).toBeNull();
  });
});

describe("SMS consent", () => {
  it("addresses an opted-in customer with a phone", () => {
    expect(sms.address(profile({ smsOptIn: true, phone: "+6591234567" }))).toBe(
      "+6591234567",
    );
  });
  it("refuses a customer who did not opt in", () => {
    expect(sms.address(profile({ smsOptIn: false, phone: "+6591234567" }))).toBeNull();
  });
  it("refuses an opted-in customer with no phone", () => {
    expect(sms.address(profile({ smsOptIn: true, phone: null }))).toBeNull();
  });
});

describe("a fully unsubscribed customer", () => {
  const unsubscribed = profile({
    whatsappOptIn: false,
    emailOptIn: false,
    smsOptIn: false,
    phone: "+6591234567",
    email: "a@b.com",
  });
  it("resolves to no address on any channel", () => {
    expect(whatsapp.address(unsubscribed)).toBeNull();
    expect(email.address(unsubscribed)).toBeNull();
    expect(sms.address(unsubscribed)).toBeNull();
  });
});

// Sprint 45: bulk CSV import is the other way consent could be bypassed — not
// by sending to someone unsubscribed, but by manufacturing an opt-in that the
// customer never gave. The channel layer above would happily address such a
// customer, so the floor has to hold at the import boundary. Full coverage of
// the parser lives in tests/customerImport.test.ts; these are the gate
// assertions, kept here so an audit of consent finds the import vector too.
describe("consent floor on CSV import", () => {
  const importRows = (csv: string) => {
    const table = parseCsv(csv);
    return parseRows(table, autoMapColumns(table));
  };

  it("imports everyone opted out when the file has no opt-in column", () => {
    const rows = importRows(
      "first_name,phone,email\n" +
        "Amara,+27821234567,amara@example.com\n" +
        "Sipho,+27839876543,sipho@example.com",
    );
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(r.whatsappOptIn).toBe(false);
      expect(r.emailOptIn).toBe(false);
      expect(r.smsOptIn).toBe(false);
    }
  });

  it("does not infer consent from an ambiguous value", () => {
    for (const v of ["1.0", "maybe", "unknown", "pending", "yes!", ""])
      expect(parseConsent(v)).toBe(false);
  });

  it("does not let one channel's opt-in imply another's", () => {
    const rows = importRows(
      "first_name,phone,email,email_opt_in\nAmara,+27821234567,a@b.com,yes",
    );
    expect(rows[0].emailOptIn).toBe(true);
    expect(rows[0].whatsappOptIn).toBe(false);
    expect(rows[0].smsOptIn).toBe(false);
  });

  it("keeps an imported opt-out unaddressable on every channel", () => {
    const rows = importRows("first_name,phone,email\nAmara,+27821234567,a@b.com");
    const imported = profile({
      whatsappOptIn: rows[0].whatsappOptIn,
      emailOptIn: rows[0].emailOptIn,
      smsOptIn: rows[0].smsOptIn,
      phone: rows[0].phone,
      email: rows[0].email,
    });
    expect(whatsapp.address(imported)).toBeNull();
    expect(email.address(imported)).toBeNull();
    expect(sms.address(imported)).toBeNull();
  });
});

// Sprint 48 opens two new ways a customer's consent state can change, so both
// get gate assertions here rather than only in their own test files.
describe("consent floor when an order import creates a customer", () => {
  // A POS export is proof that someone bought something, never that they agreed
  // to be messaged — and unlike the customer CSV there is no opt-in column to
  // read even if a file offered one. The guarantee is structural: the draft the
  // importer produces has nowhere to put consent, so the action has nothing to
  // read and writes false three times.
  const csv = [
    "Receipt Number,Date,Customer Name,Customer Email,Customer Phone,Item,Unit Price",
    "R-1,2026-07-14,Amara Okafor,amara@example.com,+65 9123 4567,Kopi O,1.80",
  ].join("\n");

  const drafts = (() => {
    const table = parseCsv(csv);
    const mappings = autoMapOrderColumns(table);
    const lines = parseOrderLines(table, mappings, Date.parse("2026-08-11T00:00:00Z"));
    const { orders } = groupIntoOrders(lines, 480);
    return resolveOrders(orders, [], [], "skip", true).newCustomers;
  })();

  it("produces a customer to create", () => {
    expect(drafts).toHaveLength(1);
    expect(drafts[0].email).toBe("amara@example.com");
  });

  it("carries no consent field at all, so there is nothing to opt in from", () => {
    // If this ever fails, someone has added a channel flag to the draft and the
    // import has become a consent vector. The floor is that the type has no
    // such field, not that the action remembers to set it false.
    const keys = Object.keys(drafts[0]);
    expect(keys.filter((k) => /opt_?in|consent|subscrib/i.test(k))).toEqual([]);
  });
});

describe("consent floor when two customers are merged", () => {
  // The union was a deliberate product decision (2026-08-11): if the absorbed
  // record opted in, the survivor inherits it, because that person did consent
  // and their signup_events row moves across with them as the record of it.
  // That makes this the ONE path in the app that raises an opt-in without the
  // customer acting, so it has to be impossible for anything other than a real
  // opted-in row to trigger it.
  function customer(p: Partial<MergeableCustomer>): MergeableCustomer {
    return {
      id: "a",
      business_id: "shop-1",
      created_at: "2026-01-01T00:00:00.000Z",
      first_name: "Amara",
      last_name: "Okafor",
      phone: null,
      email: null,
      birthday: null,
      notes: null,
      tags: [],
      custom_fields: {},
      whatsapp_opt_in: false,
      email_opt_in: false,
      sms_opt_in: false,
      last_purchase_date: null,
      last_contacted_at: null,
      ...p,
    };
  }

  function merged(absorbed: Partial<MergeableCustomer>) {
    const result = planMerge(
      customer({ id: "survivor" }),
      customer({ id: "absorbed", ...absorbed }),
    );
    if (!result.ok) throw new Error(result.reason);
    return result.plan;
  }

  it("inherits an opt-in only from a record that genuinely held one", () => {
    expect(merged({ email_opt_in: true }).fields.email_opt_in).toBe(true);
    expect(merged({ email_opt_in: false }).fields.email_opt_in).toBe(false);
  });

  it("does not treat a truthy non-boolean as consent", () => {
    // A row read back from a jsonb payload, a "true" string from a form, a 1
    // from a spreadsheet: none of these are an opt-in. Only the literal is.
    for (const v of ["true", "yes", 1, "1", {}, []] as unknown[]) {
      const p = merged({ email_opt_in: v as boolean });
      expect(p.fields.email_opt_in).toBe(false);
      expect(p.inheritedOptIns).toEqual([]);
    }
  });

  it("does not treat a missing value as consent", () => {
    for (const v of [undefined, null] as unknown[])
      expect(merged({ email_opt_in: v as boolean }).fields.email_opt_in).toBe(false);
  });

  it("leaves an inherited opt-in unaddressable without contact details", () => {
    // Inheriting the flag is not the same as being reachable — the channel
    // layer still requires an address, so a merge can't manufacture a recipient.
    const p = merged({ email_opt_in: true, email: null });
    expect(p.fields.email_opt_in).toBe(true);
    expect(
      email.address(profile({ emailOptIn: p.fields.email_opt_in, email: p.fields.email })),
    ).toBeNull();
  });

  it("reports every inherited opt-in, so the confirm screen can show it", () => {
    const p = merged({ email_opt_in: true, sms_opt_in: true });
    expect(p.inheritedOptIns).toEqual(["email_opt_in", "sms_opt_in"]);
  });
});
