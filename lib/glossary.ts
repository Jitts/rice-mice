import { ATTRIBUTION_WINDOW_DAYS } from "@/lib/attribution";
import { AT_RISK_DAYS, CHURN_DAYS, LOYAL_MIN_ORDERS } from "@/lib/segments";

// Single source of truth for every metric/term the app shows. Tooltips and the
// glossary page both render from here, and the numbers are imported from the
// same constants the engines compute with — so a definition can never drift
// from what the app actually does.

export type GlossaryGroup =
  | "Customers & loyalty"
  | "Segments"
  | "Campaigns & measurement"
  | "Orders";

export type GlossaryEntry = {
  id: string;
  term: string;
  group: GlossaryGroup;
  short: string; // one-line answer, used by tooltips
  how: string; // exactly how it's computed / what counts
  where?: string; // which screens show it
};

export const GLOSSARY: GlossaryEntry[] = [
  // --- Customers & loyalty ---
  {
    id: "loyalty",
    term: "Loyalty",
    group: "Customers & loyalty",
    short: "A customer's standing, earned from completed orders only.",
    how: "1 point per completed order plus 1 point per R100 spent. Cancelled and in-progress orders never earn anything.",
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
];

export const GLOSSARY_BY_ID: Record<string, GlossaryEntry> = Object.fromEntries(
  GLOSSARY.map((e) => [e.id, e]),
);

export const GLOSSARY_GROUPS: GlossaryGroup[] = [
  "Campaigns & measurement",
  "Customers & loyalty",
  "Segments",
  "Orders",
];
