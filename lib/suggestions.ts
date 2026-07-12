import {
  isReachable,
  stageOf,
  type CustomerProfile,
  type SegmentDefinition,
} from "@/lib/segments";
import { DEFAULT_RULES, type MarketingRules } from "@/lib/marketing";

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

export function buildSuggestions(
  profiles: CustomerProfile[],
  rules: MarketingRules = DEFAULT_RULES,
  now: Date = new Date(),
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
    });
  }

  return suggestions;
}
