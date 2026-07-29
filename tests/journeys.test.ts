import { describe, it, expect } from "vitest";
import { journeyFunnel, nodeSummary, type GraphNode } from "@/lib/journeys";

// Sprint 42 — the journey funnel groups journey_runs by status, and active
// runs further by their current position.node (the only node a run ever
// visibly "waits" at, since message/branch nodes resolve within one tick).

describe("journeyFunnel", () => {
  it("splits enrolled runs by status and queues active runs by node", () => {
    const runs = [
      { status: "active" as const, position: { node: "wait1" } },
      { status: "active" as const, position: { node: "wait1" } },
      { status: "active" as const, position: { node: "wait2" } },
      { status: "completed" as const, position: null },
      { status: "exited" as const, position: { node: "wait1" } },
    ];
    const f = journeyFunnel(runs);
    expect(f.enrolled).toBe(5);
    expect(f.active).toBe(3);
    expect(f.completed).toBe(1);
    expect(f.exited).toBe(1);
    expect(f.queue.get("wait1")).toBe(2);
    expect(f.queue.get("wait2")).toBe(1);
    // Non-active runs never contribute to the queue, even with a position.
    expect([...f.queue.values()].reduce((a, b) => a + b, 0)).toBe(3);
  });

  it("ignores an active run with no position (shouldn't happen, but stay safe)", () => {
    const f = journeyFunnel([{ status: "active" as const, position: null }]);
    expect(f.active).toBe(1);
    expect(f.queue.size).toBe(0);
  });

  it("returns all-zero for no runs", () => {
    const f = journeyFunnel([]);
    expect(f).toEqual({ enrolled: 0, active: 0, completed: 0, exited: 0, queue: new Map() });
  });
});

describe("nodeSummary", () => {
  it("describes each node type in plain text", () => {
    const wait: GraphNode = { id: "1", type: "wait", x: 0, y: 0, data: { days: 3 } };
    const message: GraphNode = {
      id: "2",
      type: "message",
      x: 0,
      y: 0,
      data: { channel: "email", body: "Come back soon!" },
    };
    const branch: GraphNode = {
      id: "3",
      type: "branch",
      x: 0,
      y: 0,
      data: { condition: "visited_since_entry" },
    };
    expect(nodeSummary(wait)).toBe("Wait 3 days");
    expect(nodeSummary(message)).toBe("Message (email): Come back soon!");
    expect(nodeSummary(branch)).toBe("Branch: visited since entry?");
  });
});
