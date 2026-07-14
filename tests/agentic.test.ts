import { describe, it, expect } from "vitest";
import {
  AGENTIC_ACTIONS,
  agenticActionDef,
  canAgentExecute,
  isApprovable,
  isLocked,
  lockedActions,
} from "@/lib/agentic";

// Red-team gate — Sprint 35 autonomy ladder. These assert the LADDER itself:
// the critical classes are locked (an agent can never run them), the one
// enabled action is on the "ask" (human-approval) rung, and anything unknown
// fails closed. This is the regression that keeps a future edit from silently
// promoting a dangerous action.

// The four classes docs/AGENTIC_LAYER.md + RED_TEAM.md call human-only forever.
const MUST_BE_LOCKED = [
  "customer.delete",
  "order.refund",
  "customers.export",
  "message.send",
] as const;

describe("critical classes are locked forever", () => {
  for (const type of MUST_BE_LOCKED) {
    it(`${type} is locked and never agent-executable`, () => {
      const def = agenticActionDef(type);
      expect(def).not.toBeNull();
      expect(def!.risk).toBe("critical");
      expect(def!.mode).toBe("locked");
      expect(isLocked(type)).toBe(true);
      expect(isApprovable(type)).toBe(false);
      expect(canAgentExecute(type)).toBe(false); // the guard the executor calls
      expect(def!.lockedReason).toBeTruthy();
    });
  }

  it("lockedActions() lists exactly the critical classes", () => {
    expect(lockedActions().map((a) => a.type).sort()).toEqual(
      [...MUST_BE_LOCKED].sort(),
    );
  });
});

describe("the enabled action is on the human-approval rung", () => {
  it("tag.apply is approvable, reversible, and executable", () => {
    const def = agenticActionDef("tag.apply");
    expect(def?.mode).toBe("ask");
    expect(def?.reversible).toBe(true);
    expect(isApprovable("tag.apply")).toBe(true);
    expect(canAgentExecute("tag.apply")).toBe(true);
    expect(isLocked("tag.apply")).toBe(false);
  });
});

describe("unknown and unattended types fail closed", () => {
  it("an unknown action type is refused everywhere", () => {
    expect(agenticActionDef("tag.nuke")).toBeNull();
    expect(isLocked("tag.nuke")).toBe(true); // unknown = treated as locked
    expect(isApprovable("tag.nuke")).toBe(false);
    expect(canAgentExecute("tag.nuke")).toBe(false);
  });

  it("no action ships on the unattended (auto) rung in v1", () => {
    // The first unattended action is a deliberate later step, gated by review.
    expect(AGENTIC_ACTIONS.some((a) => a.mode === "auto")).toBe(false);
  });

  it("every catalog entry is fully classified", () => {
    for (const a of AGENTIC_ACTIONS) {
      expect(["low", "medium", "high", "critical"]).toContain(a.risk);
      expect(["auto", "ask", "locked"]).toContain(a.mode);
      // A critical action must be locked, and a locked action must be critical —
      // the two can't drift apart.
      expect(a.risk === "critical").toBe(a.mode === "locked");
    }
  });
});
