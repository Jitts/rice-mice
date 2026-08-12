import { describe, it, expect } from "vitest";
import { readAll } from "@/lib/supabase/readAll";

// Sprint 49. The failure this guards is a read that succeeds and comes back
// short — no error, no exception, just fewer rows than exist. Every test here
// drives the helper with responses a real capped read would produce.

type Row = { id: string };

const rows = (n: number, offset = 0) =>
  Array.from({ length: n }, (_, i) => ({ id: `c-${offset + i}` }));

/**
 * A fake server holding `total` rows and refusing to return more than `cap` per
 * request — which is exactly what Supabase's `Max rows` does. Records every
 * window it was asked for so the paging itself can be asserted.
 */
function server(total: number, cap: number) {
  const windows: Array<[number, number]> = [];
  const page = (from: number, to: number) => {
    windows.push([from, to]);
    const size = Math.min(to - from + 1, cap);
    return Promise.resolve({
      data: rows(Math.max(0, Math.min(size, total - from)), from),
      error: null,
      count: total,
    });
  };
  return { page, windows };
}

describe("readAll", () => {
  it("returns everything when it fits in one page", async () => {
    const { page, windows } = server(304, 1000);
    const result = await readAll<Row>("of your existing customers", page);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.rows).toHaveLength(304);
    expect(windows).toHaveLength(1);
  });

  it("pages past the cap and returns every row exactly once", async () => {
    // The case that was silently broken before this sprint: 4,312 customers
    // behind a 1,000-row cap. The old code took the first 1,000 and carried on.
    const { page, windows } = server(4312, 1000);
    const result = await readAll<Row>("of your existing customers", page);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.rows).toHaveLength(4312);
      expect(new Set(result.rows.map((r) => r.id)).size).toBe(4312);
    }
    expect(windows).toHaveLength(5);
  });

  it("advances by what arrived, not by what it asked for", async () => {
    // With Max rows lowered to 10 the server ignores the requested window size.
    // Advancing by the REQUESTED size would skip 990 rows per page; advancing by
    // the RECEIVED size is what makes the cap testable at 10 instead of 1,000.
    const { page, windows } = server(35, 10);
    const result = await readAll<Row>("of your existing customers", page);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.rows).toHaveLength(35);
      expect(new Set(result.rows.map((r) => r.id)).size).toBe(35);
    }
    expect(windows.map(([from]) => from)).toEqual([0, 10, 20, 30]);
  });

  it("refuses when no count came back, rather than assuming the read was whole", async () => {
    // The dangerous direction to be lenient in: with no count the helper cannot
    // tell a complete read from a capped one, and guessing "fine" reinstates the
    // exact bug it exists to catch.
    const result = await readAll<Row>("of your existing customers", () =>
      Promise.resolve({ data: rows(1000), error: null, count: null }),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("Could not confirm");
  });

  it("refuses when the row count shifts mid-read", async () => {
    // Rows written while paging move the offsets underneath us, so pages already
    // fetched may have skipped or repeated rows. There is no safe way to stitch
    // that back together.
    let call = 0;
    const result = await readAll<Row>("of your existing customers", (from) =>
      Promise.resolve({ data: rows(1000, from), error: null, count: call++ === 0 ? 2500 : 2501 }),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("changed while it was being read");
  });

  it("refuses rather than spinning when the server stops returning rows", async () => {
    let call = 0;
    const result = await readAll<Row>("of your existing customers", (from) =>
      Promise.resolve({
        data: call++ === 0 ? rows(1000, from) : [],
        error: null,
        count: 4312,
      }),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("1,000");
      expect(result.error).toContain("4,312");
    }
  });

  it("refuses a table too large to hold in memory, before issuing a second page", async () => {
    const { page, windows } = server(500_000, 1000);
    const result = await readAll<Row>("of your existing customers", page);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("too many to load in one go");
    expect(windows).toHaveLength(1);
  });

  it("carries a query error out rather than reporting zero rows", async () => {
    const result = await readAll<Row>("of the orders you have already imported", () =>
      Promise.resolve({ data: null, error: { message: "permission denied" }, count: null }),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("permission denied");
  });

  it("accepts a genuinely empty table", async () => {
    // A new shop reads zero customers and that is complete, not truncated.
    const result = await readAll<Row>("of your existing customers", () =>
      Promise.resolve({ data: [], error: null, count: 0 }),
    );

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.rows).toEqual([]);
  });

  it("accepts null data alongside a zero count", async () => {
    const result = await readAll<Row>("of your existing customers", () =>
      Promise.resolve({ data: null, error: null, count: 0 }),
    );

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.rows).toEqual([]);
  });
});
