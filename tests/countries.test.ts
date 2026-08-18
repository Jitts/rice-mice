import { describe, it, expect } from "vitest";
import { COUNTRIES, flagOf, countryForDial, searchCountries } from "@/lib/countries";

// Sprint 57. The list feeds two pickers; a wrong dial code here writes a wrong
// prefix onto a real customer's phone number, and the send goes to a stranger.

describe("country data", () => {
  it("has no duplicate ISO codes", () => {
    const seen = new Set(COUNTRIES.map((c) => c.iso));
    expect(seen.size).toBe(COUNTRIES.length);
  });

  it("stores dial codes as bare digits, no plus", () => {
    const bad = COUNTRIES.filter((c) => !/^[0-9]{1,4}$/.test(c.dial));
    expect(bad).toEqual([]);
  });

  it("only emits codes migration 0029's constraint accepts", () => {
    const constraint = /^\+[0-9]{1,4}$/;
    const bad = COUNTRIES.filter((c) => !constraint.test(`+${c.dial}`));
    expect(bad).toEqual([]);
  });

  it("knows the ones this shop actually uses", () => {
    expect(COUNTRIES.find((c) => c.iso === "SG")?.dial).toBe("65");
    expect(COUNTRIES.find((c) => c.iso === "ZA")?.dial).toBe("27");
    expect(COUNTRIES.find((c) => c.iso === "MY")?.dial).toBe("60");
  });
});

describe("flagOf", () => {
  it("builds a flag from regional indicator symbols", () => {
    expect(flagOf("SG")).toBe("\u{1F1F8}\u{1F1EC}");
    expect(flagOf("za")).toBe(flagOf("ZA")); // case-insensitive
  });

  it("produces two code points for every country, so none renders blank", () => {
    const wrong = COUNTRIES.filter((c) => [...flagOf(c.iso)].length !== 2);
    expect(wrong).toEqual([]);
  });
});

describe("countryForDial", () => {
  it("resolves a stored setting back to its country", () => {
    expect(countryForDial("+65")?.iso).toBe("SG");
    expect(countryForDial("65")?.iso).toBe("SG");
  });

  it("prefers the longest matching code", () => {
    // The trap: +1876 is Jamaica, but a naive prefix match calls it the US and
    // the Settings picker would then show the wrong flag for a real setting.
    expect(countryForDial("+1876")?.iso).toBe("JM");
    expect(countryForDial("+1")?.iso).toBe("US");
  });

  it("returns null rather than guessing", () => {
    for (const v of ["", null, undefined, "+", "abc", "+99999"])
      expect(countryForDial(v), String(v)).toBeNull();
  });
});

describe("searchCountries", () => {
  it("finds by name, ISO and dialling code", () => {
    expect(searchCountries("sing").map((c) => c.iso)).toContain("SG");
    expect(searchCountries("sg").map((c) => c.iso)).toContain("SG");
    expect(searchCountries("+65").map((c) => c.iso)).toContain("SG");
    expect(searchCountries("65").map((c) => c.iso)).toContain("SG");
  });

  it("returns everything for an empty query", () => {
    expect(searchCountries("").length).toBe(COUNTRIES.length);
    expect(searchCountries("   ").length).toBe(COUNTRIES.length);
  });

  it("returns nothing rather than everything for a miss", () => {
    expect(searchCountries("zzzzz")).toEqual([]);
  });
});
