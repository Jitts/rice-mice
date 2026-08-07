import { describe, it, expect } from "vitest";
import { channelDef } from "@/lib/campaigns";
import { parseConsent, parseRows, autoMapColumns } from "@/lib/customerImport";
import { parseCsv } from "@/lib/csv";
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
