// Sprint 49 — reads that must return EVERY matching row.
//
// Supabase caps every API read at `Max rows` (1000 on this project, the
// default — Data API → Settings). Going over it is not an error: PostgREST
// answers 200 with a shorter body, the client hands back `data` as normal, and
// anything counted from it is quietly wrong.
//
// That is worse than the two silent failures the last sprints found. Sprint 47's
// `latest.at` threw once it ran; Sprint 48's copy bugs were visible on screen.
// This one produces a plausible number and no signal at all.
//
// Part 1 of the sprint made it loud: request `count: "exact"`, compare the count
// to the rows returned, refuse if they differ. Part 2 (here) makes it right —
// keep asking for the next page until the rows add up. The refusal is still in
// place underneath, so anything this can't fetch completely still fails loudly
// rather than returning a short answer.
//
// Use this for reads whose CORRECTNESS depends on completeness — matching
// against existing records, idempotency keys, aggregates. Not for lists that
// are merely displayed; those want a real paginated UI, not the whole table.

export type ReadAllResult<T> = { ok: true; rows: T[] } | { ok: false; error: string };

// Structural on purpose, rather than importing PostgrestResponse: it accepts
// any supabase-js query (table reads and `.rpc()` alike) and lets a test hand
// in a plain object literal.
type CountedResponse = {
  data: unknown[] | null;
  error: { message: string } | null;
  count: number | null;
};

/**
 * Build one page of the read. Called repeatedly with a widening window.
 *
 * The query MUST request `{ count: "exact" }`, MUST apply `.range(from, to)`,
 * and MUST carry a deterministic `.order(...)` on a unique column — see the
 * note on ordering below.
 */
export type PageQuery = (from: number, to: number) => PromiseLike<CountedResponse>;

// What we ask for per page. The server may return fewer — that is the whole
// point, and the loop advances by what actually arrived rather than by what it
// asked for, so a project with `Max rows` set to 10 pages correctly too. That
// is what makes the cap testable without seeding a 1,001-customer shop.
const PAGE_SIZE = 1000;

// Past this, loading the whole table into memory to match against it is the
// wrong design and we should say so rather than issue 200 round trips. Checked
// against the count on the first page, so a runaway is refused before it starts.
const MAX_TOTAL_ROWS = 200_000;

// Backstop for the pathological case: a server that keeps returning short
// non-empty pages would otherwise loop for a long time. Never reached in normal
// operation — at PAGE_SIZE this is 500,000 rows, well past MAX_TOTAL_ROWS.
const MAX_PAGES = 500;

export async function readAll<T>(what: string, page: PageQuery): Promise<ReadAllResult<T>> {
  const rows: T[] = [];
  let expected: number | null = null;

  for (let pages = 0; ; pages++) {
    if (pages >= MAX_PAGES)
      return { ok: false, error: `Gave up reading ${what} after ${MAX_PAGES} pages.` };

    const { data, error, count } = await page(rows.length, rows.length + PAGE_SIZE - 1);

    if (error) return { ok: false, error: `Could not read ${what} (${error.message})` };

    // No count came back, so completeness can't be established. Treating that as
    // success would defeat the point of routing the read through here — the one
    // thing this must never do is claim a read is whole when it doesn't know.
    if (count === null)
      return {
        ok: false,
        error:
          `Could not confirm that ${what} was read in full, so this was stopped ` +
          `rather than run against a possibly partial view of your data.`,
      };

    if (expected === null) {
      if (count > MAX_TOTAL_ROWS)
        return {
          ok: false,
          error:
            `There are ${count.toLocaleString()} ${what} — too many to load in one go. ` +
            `This read needs to move into the database before a shop this size can use it.`,
        };
      expected = count;
    } else if (count !== expected) {
      // Rows were written while we were paging. Offsets have shifted underneath
      // us, so pages already fetched may have skipped or repeated rows. There is
      // no safe way to stitch that together — say so and let the caller retry.
      return {
        ok: false,
        error: `${what} changed while it was being read. Nothing was written — please try again.`,
      };
    }

    const batch = (data ?? []) as T[];
    rows.push(...batch);

    if (rows.length >= expected) break;
    // An empty page while rows are still owed means the server will not give us
    // the rest, and looping again would spin forever.
    if (batch.length === 0)
      return {
        ok: false,
        error:
          `Only read ${rows.length.toLocaleString()} of ${expected.toLocaleString()} ${what}. ` +
          `This was stopped rather than run against incomplete data.`,
      };
  }

  return { ok: true, rows };
}
