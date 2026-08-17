import {
  isReachable,
  stageOf,
  type CustomerProfile,
  type SegmentDefinition,
} from "@/lib/segments";
import { DEFAULT_RULES, type MarketingRules } from "@/lib/marketing";
import { earnedPoints, type LoyaltyConfig, type Reward } from "@/lib/loyalty";

// Suggested actions: the journey data noticing something worth doing and
// offering a one-click start. Nothing executes on its own — a suggestion only
// creates/updates a saved segment and opens the campaign composer, where the
// existing compose → review → approve flow (and the human) takes over.
// This is the AGENTIC_LAYER's medium-risk pattern: suggest, human approves.

export type Suggestion = {
  id: string;
  title: string;
  detail: string;
  count: number;
  reachableCount: number;
  segmentName: string;
  definition: SegmentDefinition;
  // Sprint 52: a starting draft, so the composer opens with something to edit
  // rather than an empty box. Deliberately plain and offer-free — "Draft with
  // AI" is right there for better copy, and an opening line that promises a
  // discount nobody configured is worse than a dull one.
  campaignBody: string;
  // Sprint 55: where the button hands off. "journey" for a cohort that REFILLS
  // — people cross the line over time, and a journey enrols everyone matching
  // now (lib/journeys.ts:453) and then keeps going, so it strictly contains
  // the one-time send. "onetime" stays the default for the three suggestions
  // that had it, because retargeting live flows was not part of this change.
  mode: "onetime" | "journey";
};

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// Definitions mirror the journey-stage/glossary semantics using ordinary
// segment criteria, so the created segment shows the same people the
// suggestion counted. The rules' numbers are baked into the saved segment —
// a later rules change doesn't silently retarget an existing segment.
export function winBackDefinition(
  rules: MarketingRules = DEFAULT_RULES,
): SegmentDefinition {
  return {
    type: "group",
    combinator: "all",
    children: [
      { type: "condition", field: "order_count", op: "gte", value: 1 },
      { type: "condition", field: "last_visit", op: "before_days", value: rules.at_risk_days },
      { type: "condition", field: "last_visit", op: "within_days", value: rules.churn_days },
    ],
  };
}

export function birthdayDefinition(month: number): SegmentDefinition {
  return {
    type: "group",
    combinator: "all",
    children: [{ type: "condition", field: "birthday", op: "month_is", value: month }],
  };
}

export function newcomerDefinition(): SegmentDefinition {
  return {
    type: "group",
    combinator: "all",
    children: [
      { type: "condition", field: "signed_up", op: "within_days", value: 30 },
      { type: "condition", field: "order_count", op: "eq", value: 0 },
    ],
  };
}

// Sprint 55. "Holds enough points for the cheapest reward" — the audience the
// Reports redeemable card counts, expressed with the criterion Sprint 54 added.
// The reward's cost is baked in at build time like every other threshold here,
// so repricing a reward later doesn't silently retarget a saved segment.
export function redeemableDefinition(pointsCost: number): SegmentDefinition {
  return {
    type: "group",
    combinator: "all",
    children: [{ type: "condition", field: "loyalty_points", op: "gte", value: pointsCost }],
  };
}

export function buildSuggestions(
  profiles: CustomerProfile[],
  rules: MarketingRules = DEFAULT_RULES,
  now: Date = new Date(),
  // Sprint 55: only the redeemable suggestion needs these, and only callers
  // that already load rewards pass them. Omitted → that one suggestion is
  // absent, which FindingsPanel already handles by falling back to the link.
  loyaltyCtx?: { rewards: Reward[]; loyalty: LoyaltyConfig },
): Suggestion[] {
  const month = now.getMonth() + 1;
  const suggestions: Suggestion[] = [];

  const atRisk = profiles.filter((p) => stageOf(p, rules) === "at_risk");
  if (atRisk.length > 0) {
    suggestions.push({
      id: "win_back",
      title: "Win back at-risk customers",
      detail: `${atRisk.length} customer${atRisk.length === 1 ? "" : "s"} with loyalty haven't visited in over ${rules.at_risk_days} days.`,
      count: atRisk.length,
      reachableCount: atRisk.filter(isReachable).length,
      segmentName: "At risk — win-back (auto)",
      definition: winBackDefinition(rules),
      campaignBody:
        "Hi {{name}}, it's been a while! We'd love to see you back at rice-mice — your usual is waiting.",
      mode: "onetime",
    });
  }

  const birthdays = profiles.filter(
    (p) => p.birthday && new Date(p.birthday).getUTCMonth() + 1 === month,
  );
  if (birthdays.length > 0) {
    suggestions.push({
      id: "birthday",
      title: `${MONTH_NAMES[month - 1]} birthdays`,
      detail: `${birthdays.length} customer${birthdays.length === 1 ? "" : "s"} have a birthday this month — a small treat goes a long way.`,
      count: birthdays.length,
      reachableCount: birthdays.filter(isReachable).length,
      segmentName: "Birthdays this month (auto)",
      definition: birthdayDefinition(month),
      campaignBody:
        "Happy birthday {{name}}! Come celebrate with us at rice-mice this month.",
      mode: "onetime",
    });
  }

  const newcomers = profiles.filter((p) => {
    if (p.orderCount !== 0) return false;
    const days = (now.getTime() - new Date(p.createdAt).getTime()) / 86400000;
    return days <= 30;
  });
  if (newcomers.length > 0) {
    suggestions.push({
      id: "welcome",
      title: "Welcome your newest sign-ups",
      detail: `${newcomers.length} customer${newcomers.length === 1 ? "" : "s"} joined in the last 30 days but haven't ordered yet.`,
      count: newcomers.length,
      reachableCount: newcomers.filter(isReachable).length,
      segmentName: "New, not yet ordered (auto)",
      definition: newcomerDefinition(),
      campaignBody:
        "Hi {{name}}, thanks for joining rice-mice! Come in and try something on us — we'd love to meet you.",
      mode: "onetime",
    });
  }

  // Sprint 55. The one suggestion that is a standing condition rather than a
  // moment: customers cross the threshold continuously as they buy, so it ships
  // as a journey. Counted exactly the way lib/findings.ts counts the card it
  // sits on, and the way the criterion evaluates once saved — three code paths
  // that have to agree or the button lies about who it just built.
  const cheapest = (loyaltyCtx?.rewards ?? [])
    .filter((r) => r.active)
    .sort((a, b) => a.points_cost - b.points_cost)[0];
  if (cheapest && loyaltyCtx) {
    const canRedeem = profiles.filter(
      (p) =>
        earnedPoints(p.orderCount, p.totalSpentCents, loyaltyCtx.loyalty) -
          p.rewardPointsSpent >=
        cheapest.points_cost,
    );
    if (canRedeem.length > 0) {
      suggestions.push({
        id: "redeemable",
        title: `Remind customers who can redeem ${cheapest.name}`,
        detail: `${canRedeem.length} customer${canRedeem.length === 1 ? "" : "s"} hold ${cheapest.points_cost}+ points — enough for ${cheapest.name} right now.`,
        count: canRedeem.length,
        reachableCount: canRedeem.filter(isReachable).length,
        segmentName: `Can redeem ${cheapest.name} (auto)`,
        definition: redeemableDefinition(cheapest.points_cost),
        campaignBody: `Hi {{name}}, you've earned enough points for ${cheapest.name} — come by and claim it whenever you like.`,
        mode: "journey",
      });
    }
  }

  return suggestions;
}
