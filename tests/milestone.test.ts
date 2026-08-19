import { describe, expect, it } from "vitest";
import { buildSuggestions, milestoneDefinition, milestoneTier } from "@/lib/suggestions";
import { buildProfiles, filterProfiles, buildFieldRegistry, type CustomerRow } from "@/lib/segments";
import { datedPhrases } from "@/lib/evergreenCopy";
import type { Order } from "@/lib/orders";

// Sprint 62 (C#3). Milestone messages needed no new machinery: segments already
// counted visits and journeys already enrol each customer exactly once, which
// is what "congratulate them on their 25th visit" means. So what's worth
// testing is that the TIER stays a milestone rather than quietly becoming a
// newsletter, and that the segment the button saves selects the same people the
// suggestion just counted.

function customer(id: string): CustomerRow {
  return {
    id,
    first_name: id,
    last_name: "Tan",
    phone: `+6591000${id.length}`,
    email: `${id}@example.com`,
    whatsapp_opt_in: true,
    email_opt_in: true,
    sms_opt_in: false,
    tags: [],
    birthday: null,
    created_at: "2026-01-01T00:00:00.000Z",
    last_purchase_date: null,
    unsubscribe_token: null,
    custom_fields: {},
  } as CustomerRow;
}

function orders(customerId: string, count: number): Order[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `o-${customerId}-${i}`,
    customer_id: customerId,
    order_no: i + 1,
    status: "completed",
    total_cents: 1000,
    discount_cents: 0,
    payment_method: null,
    staff_name: null,
    campaign_id: null,
    reward_id: null,
    reward_points_spent: 0,
    created_at: "2026-06-01T00:00:00.000Z",
    order_items: [],
  })) as Order[];
}

describe("milestoneTier", () => {
  it("takes the highest tier anyone has actually reached", () => {
    // Not the lowest. On tier 5 a busy shop congratulates most of its
    // customers, which is a newsletter wearing a milestone's clothes.
    const profiles = buildProfiles(
      [customer("a"), customer("b")],
      [...orders("a", 26), ...orders("b", 6)],
    );
    expect(milestoneTier(profiles)).toBe(25);
  });

  it("is null when nobody has reached even the lowest tier", () => {
    const profiles = buildProfiles([customer("a")], orders("a", 4));
    expect(milestoneTier(profiles)).toBeNull();
  });

  it("is null for a shop with no customers at all", () => {
    expect(milestoneTier([])).toBeNull();
  });
});

describe("milestone suggestion", () => {
  const profiles = buildProfiles(
    [customer("loyal"), customer("newish")],
    [...orders("loyal", 12), ...orders("newish", 2)],
  );
  const suggestion = buildSuggestions(profiles).find((s) => s.id === "milestone")!;

  it("appears without any loyalty context, unlike the redeemable one", () => {
    // Visits are counted from orders the profile already carries, so the
    // dashboard — which never loads rewards — can offer this one too.
    expect(suggestion).toBeDefined();
    expect(suggestion.title).toContain("10th visit");
  });

  it("runs as a journey, because the cohort refills", () => {
    expect(suggestion.mode).toBe("journey");
  });

  it("counts only the people who reached the tier", () => {
    expect(suggestion.count).toBe(1);
    expect(suggestion.reachableCount).toBe(1);
  });

  it("saves a segment that selects exactly who it counted", () => {
    // The three code paths — the count above, the saved definition, and the
    // criterion evaluating it later — have to agree or the button lies about
    // the audience it just built.
    const registry = buildFieldRegistry([]);
    const matched = filterProfiles(
      milestoneDefinition(10),
      profiles,
      registry.byId,
      {},
      undefined,
    );
    expect(matched.map((p) => p.id)).toEqual(["loyal"]);
  });

  it("ships evergreen copy, so the journey's own warning stays quiet", () => {
    // A journey re-sends for as long as it runs. Copy naming a moment would
    // trip the Sprint 55 warning on every launch built from this suggestion.
    expect(datedPhrases(suggestion.campaignBody)).toEqual([]);
  });

  it("is absent for a shop nobody has visited enough", () => {
    const quiet = buildProfiles([customer("a")], orders("a", 3));
    expect(buildSuggestions(quiet).map((s) => s.id)).not.toContain("milestone");
  });
});
