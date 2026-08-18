import { describe, it, expect } from "vitest";
import { normaliseDialCode } from "@/lib/business";

// Sprint 56. The public sign-up form hard-coded "+27" for every shop on the
// platform. It's now a per-shop setting, which means an owner types it — and
// migration 0029 puts a check constraint on the column, so anything that isn't
// `+` followed by 1-4 digits fails the whole Settings save.

describe("normaliseDialCode", () => {
  it("accepts what an owner actually types", () => {
    for (const raw of ["+65", "65", " +65 ", "+65 ", "(+65)", "+ 65"])
      expect(normaliseDialCode(raw), raw).toBe("+65");
  });

  it("handles the long and short ends of real dialling codes", () => {
    expect(normaliseDialCode("1")).toBe("+1"); // US
    expect(normaliseDialCode("+1876")).toBe("+1876"); // Jamaica
    expect(normaliseDialCode("+27")).toBe("+27");
  });

  it("returns null for nothing, rather than an empty prefix", () => {
    // "+" alone would fail the DB check and block an unrelated Settings save.
    for (const raw of ["", "   ", null, undefined, "abc", "+"])
      expect(normaliseDialCode(raw), String(raw)).toBeNull();
  });

  it("refuses more digits than any dialling code has", () => {
    // Someone pasting a whole phone number into the field. Dropping the hint
    // beats writing a customer's number onto every shop's public form.
    expect(normaliseDialCode("+6591234567")).toBeNull();
    expect(normaliseDialCode("12345")).toBeNull();
  });

  it("only ever emits what migration 0029's constraint allows", () => {
    const constraint = /^\+[0-9]{1,4}$/;
    for (const raw of ["+65", "65", "1", "+1876", " 44 ", "(+61)"]) {
      const out = normaliseDialCode(raw);
      expect(out, raw).not.toBeNull();
      expect(constraint.test(out!), `${raw} -> ${out}`).toBe(true);
    }
  });
});
