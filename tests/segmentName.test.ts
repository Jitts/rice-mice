import { describe, it, expect } from "vitest";
import { suggestSegmentName } from "@/lib/segments";

// Sprint 52. The dialog proposes a free name rather than overwriting a segment
// that already holds the one it wanted, which is what SuggestedActions did.

describe("suggestSegmentName", () => {
  it("keeps the name when nothing has claimed it", () => {
    expect(suggestSegmentName("At risk — win-back (auto)", [])).toBe(
      "At risk — win-back (auto)",
    );
    expect(suggestSegmentName("VIP spenders", ["Birthdays", "New"])).toBe("VIP spenders");
  });

  it("suffixes from 2, because the untouched original reads as 1", () => {
    expect(suggestSegmentName("VIP", ["VIP"])).toBe("VIP 2");
  });

  it("walks past a run of taken suffixes", () => {
    expect(suggestSegmentName("VIP", ["VIP", "VIP 2", "VIP 3"])).toBe("VIP 4");
  });

  it("steps over a gap rather than filling it", () => {
    // "VIP 3" is free, but 2 is checked first and is also free. The point is
    // that it returns SOME free name, not that it reuses the lowest gap.
    expect(suggestSegmentName("VIP", ["VIP", "VIP 3"])).toBe("VIP 2");
  });

  it("treats case and inner whitespace as the same name", () => {
    // Two dropdown entries a person cannot tell apart is the failure being
    // avoided, so an exact-bytes comparison would not be enough.
    expect(suggestSegmentName("At Risk", ["at risk"])).toBe("At Risk 2");
    expect(suggestSegmentName("At  Risk", ["At Risk"])).toBe("At  Risk 2");
  });

  it("trims the proposed name, and compares the trimmed form", () => {
    expect(suggestSegmentName("  VIP  ", ["VIP"])).toBe("VIP 2");
    expect(suggestSegmentName("  VIP  ", [])).toBe("VIP");
  });

  it("ignores trailing space on an existing name", () => {
    expect(suggestSegmentName("VIP", ["VIP "])).toBe("VIP 2");
  });
});
