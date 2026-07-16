import { describe, it, expect } from "vitest";
import { channelDef } from "@/lib/campaigns";
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
