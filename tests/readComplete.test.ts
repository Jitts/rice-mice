import { describe, it, expect } from "vitest";
import { readComplete } from "@/lib/supabase/readComplete";

// Sprint 49 Part 1. The failure this guards is a read that succeeds and comes
// back short — no error, no exception, just fewer rows than exist. Every test
// here hands the helper a response that a real capped read would produce.

type Row = { id: string };

// A supabase query is thenable, not a Promise, so a plain object with .then is
// the honest stand-in.
function response(body: {
  data: unknown[] | null;
  error?: { message: string } | null;
  count: number | null;
}): PromiseLike<{
  data: unknown[] | null;
  error: { message: string } | null;
  count: number | null;
}> {
  return Promise.resolve({ error: null, ...body });
}

const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `c-${i}` }));

describe("readComplete", () => {
  it("returns the rows when the count agrees with what came back", async () => {
    const result = await readComplete<Row>(
      "of your existing customers",
      response({ data: rows(304), count: 304 }),
    );

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.rows).toHaveLength(304);
  });

  it("refuses a read the server capped, and says by how much", async () => {
    // Exactly what Supabase returns for a shop with 4,312 customers: HTTP 200,
    // 1,000 rows, no error anywhere. Without the count this is indistinguishable
    // from a shop that really has 1,000.
    const result = await readComplete<Row>(
      "of your existing customers",
      response({ data: rows(1000), count: 4312 }),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("1,000");
      expect(result.error).toContain("4,312");
      expect(result.error).toContain("of your existing customers");
    }
  });

  it("refuses when no count came back, rather than assuming the read was whole", async () => {
    // The dangerous direction to be lenient in: if the count is missing, the
    // helper cannot tell a complete read from a capped one, and guessing "fine"
    // reinstates the exact bug it exists to catch.
    const result = await readComplete<Row>(
      "of your existing customers",
      response({ data: rows(1000), count: null }),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("Could not confirm");
  });

  it("carries a query error out rather than reporting zero rows", async () => {
    const result = await readComplete<Row>(
      "of the orders you have already imported",
      response({ data: null, error: { message: "permission denied" }, count: null }),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("permission denied");
  });

  it("accepts a genuinely empty table", async () => {
    // A new shop reads zero customers and that is complete, not truncated.
    const result = await readComplete<Row>(
      "of your existing customers",
      response({ data: [], count: 0 }),
    );

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.rows).toEqual([]);
  });

  it("accepts null data alongside a zero count", async () => {
    const result = await readComplete<Row>(
      "of your existing customers",
      response({ data: null, count: 0 }),
    );

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.rows).toEqual([]);
  });
});
