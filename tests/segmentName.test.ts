import { describe, it, expect } from "vitest";
import {
  buildFieldRegistry,
  filterProfiles,
  suggestSegmentName,
  type CustomFieldRow,
  type CustomerProfile,
} from "@/lib/segments";
import { winBackDefinition } from "@/lib/suggestions";

const daysAgoIso = (n: number) =>
  new Date(Date.now() - n * 86_400_000).toISOString();

function profile(overrides: Partial<CustomerProfile> = {}): CustomerProfile {
  return {
    id: "c1",
    firstName: "Test",
    lastName: "Customer",
    phone: null,
    email: null,
    whatsappOptIn: false,
    emailOptIn: false,
    smsOptIn: false,
    tags: [],
    birthday: null,
    createdAt: daysAgoIso(400),
    unsubscribeToken: null,
    customFields: {},
    totalSpentCents: 0,
    orderCount: 0,
    avgOrderCents: 0,
    lastVisit: null,
    favouriteItem: null,
    itemsPurchased: [],
    paymentMethods: [],
    rewardPointsSpent: 0,
    ...overrides,
  };
}

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

// A custom field keyed like a built-in must not replace it. A Klaviyo import
// created `last_visit` as a custom DATE field, which swapped the built-in
// recency field out from under every saved definition — including the win-back
// suggestion — so they matched nobody. Found in production 2026-08-16.
describe("buildFieldRegistry precedence", () => {
  const shadow: CustomFieldRow[] = [
    {
      id: "cf-1",
      key: "last_visit",
      label: "Last visit",
      value_type: "date",
      sort_order: 1,
    } as CustomFieldRow,
  ];

  it("keeps the built-in when a custom field claims its key", () => {
    const { byId } = buildFieldRegistry(shadow);
    expect(byId.last_visit.type).toBe("recency");
    expect(byId.last_visit.operators.map((o) => o.id)).toEqual([
      "before_days",
      "within_days",
    ]);
  });

  it("does not offer the shadowed custom field in the picker", () => {
    const { list } = buildFieldRegistry(shadow);
    expect(list.filter((f) => f.id === "last_visit")).toHaveLength(1);
    expect(list.find((f) => f.id === "last_visit")?.custom).toBeFalsy();
  });

  it("still registers custom fields that collide with nothing", () => {
    const { byId, list } = buildFieldRegistry([
      { id: "cf-2", key: "city", label: "City", value_type: "text", sort_order: 1 },
    ] as CustomFieldRow[]);
    expect(byId.city.custom).toBe(true);
    expect(list.some((f) => f.id === "city")).toBe(true);
  });

  it("the win-back definition still matches a lapsed customer through the registry", () => {
    // The end-to-end version of the bug: definition + registry + evaluator.
    const { byId } = buildFieldRegistry(shadow);
    const lapsed = profile({ id: "lapsed", orderCount: 4, lastVisit: daysAgoIso(45) });
    const recent = profile({ id: "recent", orderCount: 4, lastVisit: daysAgoIso(2) });
    const def = winBackDefinition();
    expect(filterProfiles(def, [lapsed, recent], byId, {})).toEqual([lapsed]);
  });
});
