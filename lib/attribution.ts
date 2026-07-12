// Campaign attribution: which recipients placed a completed order within the
// window after their send, and how much they spent. This is post-send revenue
// ("came back within the window"), deliberately labelled as such in the UI —
// not a causal claim. Only completed orders count, consistent with loyalty.

export const ATTRIBUTION_WINDOW_DAYS = 14;

const DAY_MS = 24 * 60 * 60 * 1000;

// Minimal shapes so the engine works with any order/log selection.
export type AttributionOrder = {
  customer_id: string | null;
  status: string;
  created_at: string;
  total_cents: number | null;
};

export type SentLog = {
  customer_id: string | null;
  sent_at: string | null;
};

export type CustomerReturn = {
  orderCount: number;
  cents: number;
  firstReturnAt: string;
};

export type CampaignAttribution = {
  sentCount: number;
  returnedCount: number;
  attributedCents: number;
  byCustomer: Map<string, CustomerReturn>;
};

export function attributeCampaign(
  logs: SentLog[],
  orders: AttributionOrder[],
  windowDays: number = ATTRIBUTION_WINDOW_DAYS,
): CampaignAttribution {
  const byCustomer = new Map<string, CustomerReturn>();
  let sentCount = 0;

  // One log row per customer per campaign; ignore unsent rows entirely.
  const completed = orders.filter(
    (o) => o.status === "completed" && o.customer_id,
  );

  for (const log of logs) {
    if (!log.sent_at || !log.customer_id) continue;
    sentCount += 1;
    const sentMs = new Date(log.sent_at).getTime();
    const windowEnd = sentMs + windowDays * DAY_MS;

    for (const o of completed) {
      if (o.customer_id !== log.customer_id) continue;
      const at = new Date(o.created_at).getTime();
      if (at <= sentMs || at > windowEnd) continue;
      const prev = byCustomer.get(log.customer_id);
      if (prev) {
        prev.orderCount += 1;
        prev.cents += o.total_cents ?? 0;
        if (o.created_at < prev.firstReturnAt) prev.firstReturnAt = o.created_at;
      } else {
        byCustomer.set(log.customer_id, {
          orderCount: 1,
          cents: o.total_cents ?? 0,
          firstReturnAt: o.created_at,
        });
      }
    }
  }

  let attributedCents = 0;
  for (const r of byCustomer.values()) attributedCents += r.cents;

  return {
    sentCount,
    returnedCount: byCustomer.size,
    attributedCents,
    byCustomer,
  };
}

// Staff-observed channel reactions, from the original data model's enum.
export const OUTCOMES = ["opened", "replied", "ignored"] as const;
export type Outcome = (typeof OUTCOMES)[number];
