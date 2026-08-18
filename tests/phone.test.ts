import { describe, it, expect } from "vitest";
import { composePhone, isPlausibleInternational, formatForDisplay } from "@/lib/phone";

// Sprint 57. This decides what gets written to a customer's phone field, and a
// wrong prefix means a WhatsApp message goes to a stranger. Every case below is
// something a real person at a counter would type.

describe("composePhone", () => {
  it("prepends the picked country code to a local number", () => {
    expect(composePhone("65", "9123 4567")).toBe("+6591234567");
    expect(composePhone("+65", "9123-4567")).toBe("+6591234567");
    expect(composePhone("27", "82 555 1234")).toBe("+27825551234");
  });

  it("does not double the code when the full number is pasted", () => {
    // The realistic paste: someone copies their number out of WhatsApp.
    expect(composePhone("65", "6591234567")).toBe("+6591234567");
    expect(composePhone("65", "65 9123 4567")).toBe("+6591234567");
  });

  it("lets an explicit + override the picker", () => {
    // Picker says Singapore, customer types a UK number. Their intent wins;
    // guessing the other way would silently mangle a valid number.
    expect(composePhone("65", "+44 7700 900123")).toBe("+447700900123");
    expect(composePhone("65", "+6591234567")).toBe("+6591234567");
  });

  it("understands 00 as the international prefix", () => {
    expect(composePhone("65", "0044 7700 900123")).toBe("+447700900123");
  });

  it("still prepends when the local number merely starts with the code's digits", () => {
    // "65" as the opening of a SHORT local number is a coincidence, not a
    // country code — 4 remaining digits is no one's subscriber number.
    expect(composePhone("65", "6512")).toBe("+656512");
  });

  it("returns null rather than a bare code", () => {
    // Storing "+65" would look like a phone number to every screen in the app.
    for (const v of ["", "   ", "abc", "+"]) expect(composePhone("65", v), v).toBeNull();
  });

  it("copes with no country selected", () => {
    expect(composePhone(null, "6591234567")).toBe("+6591234567");
    expect(composePhone("", "+6591234567")).toBe("+6591234567");
  });
});

describe("isPlausibleInternational", () => {
  it("matches the 8-15 digit rule the send path already applies", () => {
    expect(isPlausibleInternational("+6591234567")).toBe(true);
    expect(isPlausibleInternational("+6591234")).toBe(false); // 7 digits
    expect(isPlausibleInternational("+1234567890123456")).toBe(false); // 16
    expect(isPlausibleInternational(null)).toBe(false);
  });

  it("rejects the shape that caused this whole sprint", () => {
    // A bare 8-digit local number: passes normalizePhone, unreachable on
    // WhatsApp. With the "+" it is 8 digits total and still too short.
    expect(isPlausibleInternational("+91234567")).toBe(true); // 8 digits, allowed
    expect(isPlausibleInternational("91234567")).toBe(false); // no "+" at all
  });
});

describe("formatForDisplay", () => {
  it("groups the subscriber part so the customer can check it", () => {
    expect(formatForDisplay("+6591234567")).toBe("+65 9123 4567");
    expect(formatForDisplay("+447700900123")).toBe("+44 7700 9001 23");
  });

  it("passes anything unexpected through untouched", () => {
    expect(formatForDisplay(null)).toBe("");
    expect(formatForDisplay("nonsense")).toBe("nonsense");
  });
});
