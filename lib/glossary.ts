import { DEFAULT_RULES, type MarketingRules } from "@/lib/marketing";

// Single source of truth for every metric/term the app shows. Tooltips and the
// glossary page both render from here, built from the same marketing-rules
// object the engines compute with — so a definition can never drift from what
// the app actually does, even after an owner edits the rules in Settings.

export type GlossaryGroup =
  | "Customers & loyalty"
  | "Segments"
  | "Campaigns & measurement"
  | "Orders"
  | "Reports";

export type GlossaryEntry = {
  id: string;
  term: string;
  group: GlossaryGroup;
  short: string; // one-line answer, used by tooltips
  how: string; // exactly how it's computed / what counts
  where?: string; // which screens show it
};

export function buildGlossary(
  rules: MarketingRules = DEFAULT_RULES,
): GlossaryEntry[] {
  const {
    at_risk_days: AT_RISK_DAYS,
    churn_days: CHURN_DAYS,
    loyal_min_orders: LOYAL_MIN_ORDERS,
    attribution_window_days: ATTRIBUTION_WINDOW_DAYS,
  } = rules;
  return [
  // --- Customers & loyalty ---
  {
    id: "loyalty",
    term: "Loyalty",
    group: "Customers & loyalty",
    short: "A customer's standing, earned from completed orders only.",
    how: "1 point per completed order plus 1 point per $100 spent. Cancelled and in-progress orders never earn anything.",
    where: "Dashboard sign-ups table.",
  },
  {
    id: "at_risk",
    term: "At risk",
    group: "Customers & loyalty",
    short: "A customer you're in danger of losing.",
    how: `Has loyalty points but hasn't purchased in over ${AT_RISK_DAYS} days. A prompt to win them back, not a verdict.`,
    where: "Dashboard sign-ups table, customer journey.",
  },
  {
    id: "points_balance",
    term: "Points balance",
    group: "Customers & loyalty",
    short: "The loyalty points a customer can currently spend.",
    how: "Earned points (1 per completed order, 1 per $100 spent) minus points already redeemed on rewards. Cancelling an order refunds both what it earned and any reward redeemed on it. Shown at the order pad when a customer is selected.",
    where: "Order pad.",
  },
  {
    id: "reward",
    term: "Reward",
    group: "Customers & loyalty",
    short: "Something a customer redeems with loyalty points.",
    how: "Owners define rewards in Settings — a points cost plus a discount (percent or fixed amount). Staff redeem one at the order pad for a customer with enough points; it discounts that order and spends the points. A reward and a campaign offer code can't both be on one order.",
    where: "Order pad, Settings → Loyalty rewards.",
  },
  {
    id: "reachable",
    term: "Reachable",
    group: "Customers & loyalty",
    short: "Can legally receive your marketing.",
    how: "Opted in on at least one channel (WhatsApp or email) and has the matching contact info. Campaigns can only ever send to reachable customers — unsubscribing makes someone unreachable instantly.",
    where: "Segments preview, campaign composer.",
  },
  {
    id: "walk_in",
    term: "Walk-in",
    group: "Customers & loyalty",
    short: "An order not linked to any customer record.",
    how: "Walk-ins never earn loyalty and are excluded from campaign measurement, because there's no customer to follow up with.",
    where: "Order pad, dashboard orders table.",
  },

  // --- Segments ---
  {
    id: "matches",
    term: "Matches",
    group: "Segments",
    short: "Customers who fit a segment's criteria right now.",
    how: "Recomputed live from customer and order data every time a condition changes — a segment has no fixed member list, so people flow in and out as their behaviour changes.",
    where: "Segment builder preview.",
  },
  {
    id: "journey_stages",
    term: "Customer journey stages",
    group: "Segments",
    short: "Where each customer sits in their lifecycle, from first visit to lost.",
    how: `New = signed up, no completed orders yet. Active = bought recently, fewer than ${LOYAL_MIN_ORDERS} orders. Loyal = ${LOYAL_MIN_ORDERS}+ completed orders and still visiting. At risk = last visit ${AT_RISK_DAYS}–${CHURN_DAYS} days ago. Churned = no visit in over ${CHURN_DAYS} days. Each customer is in exactly one stage.`,
    where: "Segments page ribbon.",
  },
  {
    id: "starter_segment",
    term: "Starter segment",
    group: "Segments",
    short: "A ready-made segment that ships with the app.",
    how: "A starting point, not a rule — edit, rename or delete them freely.",
    where: "Saved segments list.",
  },

  // --- Campaigns & measurement ---
  {
    id: "sent",
    term: "Sent",
    group: "Campaigns & measurement",
    short: "Messages actually dispatched by a person.",
    how: "A recipient counts as sent when a staff member opens their message and presses send — the app never sends on its own.",
    where: "Campaign progress, send run.",
  },
  {
    id: "came_back",
    term: "Came back",
    group: "Campaigns & measurement",
    short: "A recipient who returned after getting a campaign message.",
    how: `Placed a completed order after their message was sent, within ${ATTRIBUTION_WINDOW_DAYS} days of it. This shows who returned in the window — it can't prove the message caused the visit.`,
    where: "Campaigns list, campaign results.",
  },
  {
    id: "revenue_after_send",
    term: "Revenue after send",
    group: "Campaigns & measurement",
    short: "What returning recipients spent.",
    how: `The total of every completed order placed by the campaign's recipients within ${ATTRIBUTION_WINDOW_DAYS} days of their send. Same honest caveat as "came back": after the message, not necessarily because of it.`,
    where: "Campaigns list, campaign results.",
  },
  {
    id: "journey",
    term: "Journey",
    group: "Campaigns & measurement",
    short: "A staff-designed flow that follows a saved segment automatically after you launch it.",
    how: "You pick the audience (any saved segment — the same one campaigns use) and design what happens (waits, yes/no branches, message drafts), then launch it for a period or evergreen. While it runs, qualifying customers are enrolled once each and stepped through the flow. It never sends anything — drafts land in the action inbox for a person to send, and sends count in the journey's own results, same as a campaign.",
    where: "Campaigns page (Journeys tab), action inbox.",
  },
  {
    id: "action_inbox",
    term: "Action inbox",
    group: "Campaigns & measurement",
    short: "Work your journeys prepared, waiting for a person.",
    how: "Each item is a ready-to-send draft for one customer. Review & send opens WhatsApp or your mail app with the message ready — you press send, and it's logged to the customer's history. Skip dismisses it. Consent is re-checked at send time.",
    where: "Dashboard.",
  },
  {
    id: "offer_code",
    term: "Offer code",
    group: "Campaigns & measurement",
    short: "A discount code a campaign carries.",
    how: "Set when composing a campaign (percent or dollar amount). Staff apply it on the order pad; the discount comes off the order and the redemption is stamped with the campaign. Codes aren't locked to recipients — staff judgment applies at the counter.",
    where: "Campaign composer, order pad.",
  },
  {
    id: "redeemed",
    term: "Redeemed",
    group: "Campaigns & measurement",
    short: "A completed order that used this campaign's offer code.",
    how: "Exact attribution — no time window, and walk-ins count too. Stronger evidence than \"came back\", which only shows a return within the window.",
    where: "Campaign results, campaigns list.",
  },
  {
    id: "outcome",
    term: "Outcome",
    group: "Campaigns & measurement",
    short: "A staff-recorded reaction to a message.",
    how: "Opened / replied / ignored — tap to record what you saw on the channel, tap again to clear. Separate from \"came back\", which is computed automatically from orders.",
    where: "Send run rows.",
  },

  // --- Orders ---
  {
    id: "order_status",
    term: "Order status",
    group: "Orders",
    short: "The kitchen flow of an order.",
    how: "Open → preparing → ready → completed; cancelled voids an order. Only completed orders count anywhere money or loyalty is measured.",
    where: "Order pad, order detail, dashboard.",
  },
  {
    id: "revenue",
    term: "Revenue",
    group: "Orders",
    short: "Money from completed orders.",
    how: "The sum of every completed order's total. Cancelled and in-progress orders are never included.",
    where: "Dashboard metrics.",
  },
  {
    id: "total_spent",
    term: "Total spent / average order",
    group: "Orders",
    short: "A customer's lifetime spend on completed orders.",
    how: "Total spent sums a customer's completed orders; average order divides that by their order count. Both are segment criteria.",
    where: "Segment builder, segment preview table.",
  },

  // --- Reports ---
  {
    id: "avg_order_value",
    term: "Average order value",
    group: "Reports",
    short: "What a typical order was worth in the selected period.",
    how: "Revenue divided by the number of completed orders in the selected date range. Cancelled and in-progress orders are excluded from both sides.",
    where: "Reports page.",
  },
  {
    id: "gross_item_sales",
    term: "Item sales (gross)",
    group: "Reports",
    short: "What an item sold for before any offer discount.",
    how: "Line price × quantity across completed orders in the range. Offer discounts apply to a whole order, not to individual lines, so item sales can add up to slightly more than revenue when discounts were given.",
    where: "Reports page, top items table.",
  },
  {
    id: "discounts_given",
    term: "Discounts given",
    group: "Reports",
    short: "What offer codes cost you in the selected period.",
    how: "The sum of the discount on every completed order in the range. Revenue already has these taken off — this shows what was given away to earn it.",
    where: "Reports page.",
  },
  {
    id: "report_day",
    term: "Reporting day",
    group: "Reports",
    short: "An order counts on the day it was placed.",
    how: "The date range filters by when orders were placed (the shop's local time). Money still only counts once an order completes.",
    where: "Reports page.",
  },
  ];
}

export function glossaryById(
  rules: MarketingRules = DEFAULT_RULES,
): Record<string, GlossaryEntry> {
  return Object.fromEntries(buildGlossary(rules).map((e) => [e.id, e]));
}

export const GLOSSARY_GROUPS: GlossaryGroup[] = [
  "Campaigns & measurement",
  "Customers & loyalty",
  "Segments",
  "Orders",
  "Reports",
];
