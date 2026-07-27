import { describe, it, expect } from "vitest";
import { attributeCampaign } from "@/lib/attribution";

// Sprint 41 leans on attributeCampaign(logs, orders, windowDays) — no
// campaignId — as the cross-campaign + cross-journey revenue rollup on
// Reports and in the analyst snapshot. That usage was implicit before
// (every existing caller always passed one campaign/journey's own logs);
// this asserts it actually sums correctly across mixed sources.

describe("attributeCampaign as a rollup (no campaignId)", () => {
  it("sums sent/returned/revenue across logs from different campaigns and journeys", () => {
    const logs = [
      { customer_id: "a", sent_at: "2026-01-01T00:00:00Z", campaign_id: "camp1" },
      { customer_id: "b", sent_at: "2026-01-02T00:00:00Z", journey_id: "jour1" },
    ];
    const orders = [
      {
        customer_id: "a",
        status: "completed",
        created_at: "2026-01-03T00:00:00Z",
        total_cents: 1000,
      },
      {
        customer_id: "b",
        status: "completed",
        created_at: "2026-01-04T00:00:00Z",
        total_cents: 500,
      },
    ];
    const r = attributeCampaign(logs, orders, 14);
    expect(r.sentCount).toBe(2);
    expect(r.returnedCount).toBe(2);
    expect(r.attributedCents).toBe(1500);
    // No campaignId given — the exact-redemption bucket stays empty, only the
    // window-based revenue counts.
    expect(r.redeemedCount).toBe(0);
  });

  it("ignores unsent rows and orders outside the window", () => {
    const logs = [
      { customer_id: "a", sent_at: null, campaign_id: "camp1" },
      { customer_id: "b", sent_at: "2026-01-01T00:00:00Z", journey_id: "jour1" },
    ];
    const orders = [
      {
        customer_id: "b",
        status: "completed",
        created_at: "2026-02-01T00:00:00Z", // way past a 14-day window
        total_cents: 999,
      },
    ];
    const r = attributeCampaign(logs, orders, 14);
    expect(r.sentCount).toBe(1);
    expect(r.returnedCount).toBe(0);
    expect(r.attributedCents).toBe(0);
  });
});
