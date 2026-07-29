import { describe, it, expect } from "vitest";
import { analystModels, resolveAnalystModel } from "@/lib/analystModel";

// The analyst went down in production when Google's "-latest" aliases rolled
// onto Gemini 3, which rejects the thinkingBudget parameter the runner was
// sending. Two guards against a repeat: model ids stay pinned, and a business
// holding a now-removed id self-heals to a valid one instead of 400-ing.

describe("gemini model catalog", () => {
  const ids = analystModels().map((m) => m.id);

  it("pins every model id — no floating aliases", () => {
    // An alias can change model family under us, which is exactly the failure
    // that broke the analyst. Pinned ids only.
    for (const id of ids) expect(id).not.toMatch(/latest/);
  });

  it("offers at least one model", () => {
    expect(ids.length).toBeGreaterThan(0);
  });
});

describe("resolveAnalystModel", () => {
  it("keeps a stored id that is still offered", () => {
    const first = analystModels()[0].id;
    expect(resolveAnalystModel(first)).toBe(first);
  });

  it("falls back to the default for a retired id", () => {
    // A business that had picked gemini-flash-latest must land on a working
    // model on its next request, without anyone editing the database.
    expect(resolveAnalystModel("gemini-flash-latest")).toBe(analystModels()[0].id);
  });

  it("falls back for null or an unknown provider's id", () => {
    expect(resolveAnalystModel(null)).toBe(analystModels()[0].id);
    expect(resolveAnalystModel("claude-sonnet-5")).toBe(analystModels()[0].id);
  });
});
