import { describe, it, expect } from "vitest";
import { datedPhrases, evergreenWarning } from "@/lib/evergreenCopy";
import { buildSuggestions } from "@/lib/suggestions";
import { buildProfiles, type CustomerRow } from "@/lib/segments";
import { DEFAULT_LOYALTY, type LoyaltyConfig, type Reward } from "@/lib/loyalty";
import type { Order } from "@/lib/orders";

// Sprint 55. A journey re-sends its message for as long as it runs, so copy
// that names a moment goes stale while it is still going out. The one thing
// this must not do is cry wolf: a warning that fires on ordinary copy gets
// clicked through, and then it is worth nothing when it is right.

describe("datedPhrases", () => {
  it("catches copy that pins itself to a moment", () => {
    for (const body of [
      "Free drink this weekend only!",
      "Come in tomorrow for a treat",
      "Offer ends Friday",
      "Last chance to redeem",
      "Our October special is here",
      "Limited time — 10% off",
      "See you next week!",
      "Best of 2026 starts now",
    ]) {
      expect(datedPhrases(body), body).not.toHaveLength(0);
    }
  });

  it("leaves genuinely evergreen copy alone", () => {
    for (const body of [
      // The draft the redeemable suggestion actually ships with — if this ever
      // trips the check, every reminder built from Reports opens with a warning.
      "Hi {{name}}, you've earned enough points for Free drink — come by and claim it whenever you like.",
      "Hi {{name}}, it's been a while! We'd love to see you back — your usual is waiting.",
      "Thanks for joining! Come in and try something on us.",
      "You're 20 points away from your next reward.",
    ]) {
      expect(datedPhrases(body), body).toEqual([]);
    }
  });

  it("deduplicates repeats but keeps distinct phrases", () => {
    const found = datedPhrases("This weekend! Yes, THIS WEEKEND. And tomorrow too.");
    expect(found.map((f) => f.phrase.toLowerCase()).sort()).toEqual([
      "this weekend",
      "tomorrow",
    ]);
  });

  it("does not carry regex state between calls", () => {
    // Module-level /g patterns share lastIndex. A stale index would make the
    // second call miss a match at the start of the string — the kind of bug
    // that only shows up on the second journey somebody launches.
    const first = datedPhrases("This weekend and this month and tomorrow");
    const second = datedPhrases("This weekend");
    expect(first.length).toBeGreaterThan(1);
    expect(second).toHaveLength(1);
  });
});

describe("evergreenWarning", () => {
  it("is null when nothing expires", () => {
    expect(evergreenWarning(["Come by whenever you like."])).toBeNull();
    expect(evergreenWarning([])).toBeNull();
  });

  it("names the offending phrase across every message in the flow", () => {
    const w = evergreenWarning(["Hi {{name}}!", "Still here? Offer ends Sunday."]);
    expect(w).toContain("ends Sunday");
    expect(w).toContain("runs until you stop it");
  });
});

// --- the suggestion this was built for ---------------------------------------

const REWARDS: Reward[] = [
  { id: "a", name: "10% off", points_cost: 40, active: true },
  { id: "b", name: "Free drink", points_cost: 50, active: true },
  { id: "c", name: "Free pastry", points_cost: 5, active: false },
] as Reward[];

// Matches the shop's real rates, not the defaults — 5/order, 1 per 120c, 30 bonus.
const LOYALTY: LoyaltyConfig = {
  ...DEFAULT_LOYALTY,
  points_per_order: 5,
  cents_per_point: 120,
  signup_bonus_points: 30,
};

function customer(id: string): CustomerRow {
  return {
    id,
    first_name: "Test",
    last_name: id,
    phone: "+6580000000",
    email: null,
    whatsapp_opt_in: true,
    email_opt_in: false,
    sms_opt_in: false,
    tags: [],
    birthday: null,
    created_at: "2026-01-01T00:00:00.000Z",
    last_purchase_date: null,
    unsubscribe_token: null,
    custom_fields: {},
  } as CustomerRow;
}

function order(customer_id: string, total_cents: number): Order {
  return {
    id: `o-${customer_id}-${total_cents}`,
    customer_id,
    order_no: 1,
    status: "completed",
    total_cents,
    discount_cents: 0,
    payment_method: null,
    staff_name: null,
    campaign_id: null,
    reward_id: null,
    reward_points_spent: 0,
    created_at: "2026-06-01T00:00:00.000Z",
    order_items: [],
  } as Order;
}

describe("redeemable suggestion", () => {
  const rich = customer("rich"); // 1 order of $12 → 5 + 10 + 30 bonus = 45 pts
  const poor = customer("poor"); // no orders → 30 pts (the signup bonus alone)
  const profiles = buildProfiles([rich, poor], [order("rich", 1200)]);

  it("is absent when the caller supplies no rewards", () => {
    // SuggestedActions on the dashboard doesn't load rewards. It must degrade
    // to "no suggestion" rather than to a suggestion built on guessed rates.
    const ids = buildSuggestions(profiles).map((s) => s.id);
    expect(ids).not.toContain("redeemable");
  });

  it("targets the cheapest ACTIVE reward, ignoring inactive ones", () => {
    const s = buildSuggestions(profiles, undefined, new Date(), {
      rewards: REWARDS,
      loyalty: LOYALTY,
    }).find((x) => x.id === "redeemable")!;
    // Free pastry at 5 pts is cheaper but inactive; 10% off at 40 wins.
    expect(s.title).toContain("10% off");
    expect(s.definition).toMatchObject({
      children: [{ field: "loyalty_points", op: "gte", value: 40 }],
    });
  });

  it("counts the same people the saved segment will match", () => {
    // The whole point of the button: what it promises and what it builds have
    // to be the same set. rich has 45 pts (≥40), poor has 30.
    const s = buildSuggestions(profiles, undefined, new Date(), {
      rewards: REWARDS,
      loyalty: LOYALTY,
    }).find((x) => x.id === "redeemable")!;
    expect(s.count).toBe(1);
    expect(s.reachableCount).toBe(1);
  });

  it("goes to a journey, because the cohort refills", () => {
    const s = buildSuggestions(profiles, undefined, new Date(), {
      rewards: REWARDS,
      loyalty: LOYALTY,
    }).find((x) => x.id === "redeemable")!;
    expect(s.mode).toBe("journey");
  });

  it("ships copy that survives its own evergreen check", () => {
    const s = buildSuggestions(profiles, undefined, new Date(), {
      rewards: REWARDS,
      loyalty: LOYALTY,
    }).find((x) => x.id === "redeemable")!;
    expect(datedPhrases(s.campaignBody)).toEqual([]);
  });

  it("is absent when nobody qualifies", () => {
    const nobody = buildProfiles([poor], []);
    const ids = buildSuggestions(nobody, undefined, new Date(), {
      rewards: REWARDS,
      loyalty: LOYALTY,
    }).map((s) => s.id);
    expect(ids).not.toContain("redeemable");
  });
});
