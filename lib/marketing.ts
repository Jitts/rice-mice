// The marketing rules: the four thresholds every lifecycle/measurement engine
// computes with. Stored on the business_settings singleton (Settings →
// Marketing rules) and threaded to the engines via RulesProvider; these
// defaults are what shipped before the rules were editable, and every
// consumer falls back to them so a missing row can never change behaviour.

export type MarketingRules = {
  attribution_window_days: number;
  at_risk_days: number;
  churn_days: number;
  loyal_min_orders: number;
};

export const DEFAULT_RULES: MarketingRules = {
  attribution_window_days: 14,
  at_risk_days: 30,
  churn_days: 90,
  loyal_min_orders: 3,
};

// Field metadata the Settings form renders from — bounds mirror the DB checks.
export type RuleFieldDef = {
  key: keyof MarketingRules;
  label: string;
  unit: string;
  help: string;
  min: number;
  max: number;
};

export const RULE_FIELDS: RuleFieldDef[] = [
  {
    key: "at_risk_days",
    label: "At risk after",
    unit: "days",
    help: "A customer with orders becomes \"at risk\" when they haven't visited for this long. Drives the journey ribbon, the dashboard at-risk flags and the win-back suggestion.",
    min: 1,
    max: 365,
  },
  {
    key: "churn_days",
    label: "Churned after",
    unit: "days",
    help: "No visit for this long counts as churned. Must be longer than the at-risk window.",
    min: 2,
    max: 730,
  },
  {
    key: "loyal_min_orders",
    label: "Loyal from",
    unit: "orders",
    help: "Completed orders needed to count as a loyal customer (while still visiting).",
    min: 1,
    max: 100,
  },
  {
    key: "attribution_window_days",
    label: "Attribution window",
    unit: "days",
    help: "How long after a campaign send a completed order still counts as \"came back\". Offer-code redemptions are exact and ignore this window.",
    min: 1,
    max: 365,
  },
];

function toPositiveInt(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return null;
  const i = Math.round(n);
  return i >= 1 ? i : null;
}

export function withRuleDefaults(
  row: Partial<Record<keyof MarketingRules, unknown>> | null | undefined,
): MarketingRules {
  const rules = { ...DEFAULT_RULES };
  for (const f of RULE_FIELDS) {
    const v = toPositiveInt(row?.[f.key]);
    if (v !== null) rules[f.key] = v;
  }
  return rules;
}

// Cross-field sanity for the Settings form; the DB check is the backstop.
export function validateRules(rules: MarketingRules): string | null {
  for (const f of RULE_FIELDS) {
    const v = rules[f.key];
    if (!Number.isInteger(v) || v < f.min || v > f.max)
      return `${f.label} must be a whole number between ${f.min} and ${f.max}`;
  }
  if (rules.churn_days <= rules.at_risk_days)
    return "The churn threshold must be longer than the at-risk window — otherwise the stages overlap";
  return null;
}
