import { describe, it, expect } from "vitest";
import { compileJourneyFlow, parsePlan, validateNode } from "@/lib/plannerAgent";
import { validateGraph } from "@/lib/journeys";
import { FIELDS } from "@/lib/segments";

// The planner lets a model propose a segment tree that a human then applies.
// parsePlan is the gate: anything the model invents — a field that doesn't
// exist, an operator that field doesn't support, a channel that can't send —
// must be rejected here rather than reaching the builder or the database.

const ctx = {
  mode: "segment" as const,
  fieldsById: FIELDS,
  sendableChannels: ["whatsapp" as const],
  validSegmentIds: new Set<string>(["seg-1"]),
};

const goodTree = {
  type: "group",
  combinator: "all",
  children: [
    { type: "condition", field: "order_count", op: "gte", value: 3 },
    { type: "condition", field: "last_visit", op: "before_days", value: 30 },
  ],
};

function plan(extra: Record<string, unknown> = {}) {
  return JSON.stringify({
    name: "Lapsed regulars",
    explanation: "Regulars who have not been in for a month.",
    steps: ["At least 3 orders", "Last visit over 30 days ago"],
    concerns: ["May overlap with a recent campaign."],
    definition: goodTree,
    ...extra,
  });
}

describe("parsePlan", () => {
  it("accepts a valid segment plan", () => {
    const r = parsePlan(plan(), ctx);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plan.name).toBe("Lapsed regulars");
    expect(r.plan.definition.children).toHaveLength(2);
  });

  it("rejects an invented field", () => {
    const r = parsePlan(
      plan({
        definition: {
          type: "group",
          combinator: "all",
          children: [{ type: "condition", field: "loyalty_score", op: "gte", value: 5 }],
        },
      }),
      ctx,
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain("loyalty_score");
  });

  it("rejects an operator the field doesn't support", () => {
    const r = parsePlan(
      plan({
        definition: {
          type: "group",
          combinator: "all",
          children: [{ type: "condition", field: "order_count", op: "contains", value: "x" }],
        },
      }),
      ctx,
    );
    expect(r.ok).toBe(false);
  });

  it("rejects a reference to a segment that doesn't exist", () => {
    const r = parsePlan(
      plan({
        definition: {
          type: "group",
          combinator: "all",
          children: [{ type: "segment_ref", segmentId: "nope", mode: "include" }],
        },
      }),
      ctx,
    );
    expect(r.ok).toBe(false);
  });

  it("strips a markdown fence the model wrapped the JSON in", () => {
    const r = parsePlan("```json\n" + plan() + "\n```", ctx);
    expect(r.ok).toBe(true);
  });

  it("never returns an empty concerns list", () => {
    const r = parsePlan(plan({ concerns: [] }), ctx);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // An empty section would read like a clean bill of health; it must say
    // plainly that the assistant flagged nothing instead.
    expect(r.plan.concerns.length).toBeGreaterThan(0);
    expect(r.plan.concerns[0]).toMatch(/didn't flag/i);
  });

  it("rejects a campaign plan on a channel that can't send", () => {
    const r = parsePlan(plan({ channel: "sms", body: "hi {{name}}" }), {
      ...ctx,
      mode: "campaign",
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain("sms");
  });

  it("rejects a campaign plan with no message body", () => {
    const r = parsePlan(plan({ channel: "whatsapp", body: "" }), {
      ...ctx,
      mode: "campaign",
    });
    expect(r.ok).toBe(false);
  });

  it("drops unknown keys rather than passing them through to storage", () => {
    const r = parsePlan(
      plan({
        definition: {
          type: "group",
          combinator: "all",
          evil: "payload",
          children: [
            { type: "condition", field: "order_count", op: "gte", value: 3, extra: "x" },
          ],
        },
      }),
      ctx,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plan.definition).not.toHaveProperty("evil");
    expect(r.plan.definition.children[0]).not.toHaveProperty("extra");
  });

  it("rejects unreadable output", () => {
    expect(parsePlan("I'd be happy to help!", ctx).ok).toBe(false);
  });
});

describe("journey mode", () => {
  const jctx = { ...ctx, mode: "journey" as const };
  const flow = [
    { kind: "wait", days: 7 },
    { kind: "message", channel: "whatsapp", body: "Hi {{name}}, we miss you!" },
  ];

  it("accepts a valid linear flow", () => {
    const r = parsePlan(plan({ flow }), jctx);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plan.flow).toHaveLength(2);
  });

  it("rejects a flow that never sends anything", () => {
    const r = parsePlan(plan({ flow: [{ kind: "wait", days: 3 }] }), jctx);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/never sends/i);
  });

  it("rejects a message on a channel that can't send", () => {
    const r = parsePlan(
      plan({ flow: [{ kind: "message", channel: "line", body: "hi" }] }),
      jctx,
    );
    expect(r.ok).toBe(false);
  });

  it("rejects an absurd wait length", () => {
    const r = parsePlan(
      plan({ flow: [{ kind: "wait", days: 900 }, ...flow.slice(1)] }),
      jctx,
    );
    expect(r.ok).toBe(false);
  });

  it("rejects an unknown step kind", () => {
    const r = parsePlan(plan({ flow: [{ kind: "webhook", url: "http://evil" }] }), jctx);
    expect(r.ok).toBe(false);
  });

  it("rejects a missing flow", () => {
    expect(parsePlan(plan(), jctx).ok).toBe(false);
  });
});

describe("compileJourneyFlow", () => {
  it("wires trigger → steps in order, with no dangling edges", () => {
    const def = compileJourneyFlow(
      [
        { kind: "wait", days: 7 },
        { kind: "message", channel: "whatsapp", body: "Hi {{name}}" },
      ],
      "seg-1",
      "Lapsed regulars",
    );
    expect(def.nodes[0]).toMatchObject({
      id: "trigger",
      type: "trigger",
      data: { segmentId: "seg-1" },
    });
    expect(def.nodes.map((n) => n.type)).toEqual(["trigger", "wait", "message"]);

    // Every edge must land on a node that exists — the reason we compile the
    // graph instead of letting the model emit nodes and edges directly.
    const ids = new Set(def.nodes.map((n) => n.id));
    for (const e of def.edges) {
      expect(ids.has(e.from)).toBe(true);
      expect(ids.has(e.to)).toBe(true);
    }
    expect(def.edges).toHaveLength(2);
  });

  it("passes the builder's own graph validation", () => {
    const def = compileJourneyFlow(
      [{ kind: "message", channel: "whatsapp", body: "Hi {{name}}" }],
      "seg-1",
      "Lapsed",
    );
    // validateGraph is what gates the Launch button, so a compiled plan has to
    // clear it or Apply would hand the user a journey they can't launch.
    expect(validateGraph(def, new Set(["seg-1"]))).toEqual([]);
  });
});

describe("validateNode depth and size limits", () => {
  it("rejects a tree nested past the depth limit", () => {
    let node: Record<string, unknown> = {
      type: "condition",
      field: "order_count",
      op: "gte",
      value: 1,
    };
    for (let i = 0; i < 8; i++) {
      node = { type: "group", combinator: "all", children: [node] };
    }
    expect(validateNode(node, FIELDS, new Set()).length).toBeGreaterThan(0);
  });

  it("rejects a tree with too many nodes", () => {
    const children = Array.from({ length: 60 }, () => ({
      type: "condition",
      field: "order_count",
      op: "gte",
      value: 1,
    }));
    const problems = validateNode(
      { type: "group", combinator: "all", children },
      FIELDS,
      new Set(),
    );
    expect(problems.length).toBeGreaterThan(0);
  });
});
