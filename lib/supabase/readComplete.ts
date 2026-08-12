// Sprint 49 Part 1 — reads that must return EVERY matching row.
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
// The fix is to ask. Requesting `count: "exact"` makes PostgREST report the
// true total in Content-Range alongside the capped rows, so the two can be
// compared. Fewer rows than the count means the read was truncated, and the
// caller is told instead of carrying on.
//
// Use this for reads whose CORRECTNESS depends on completeness — matching
// against existing records, idempotency keys, aggregates. Not for lists that
// are merely displayed; those should be paginated, not counted.
//
// Cost: `count: "exact"` runs a real COUNT on every call. That is the price of
// knowing, and it is only paid on the handful of reads wired through here.

export type CompleteRead<T> = { ok: true; rows: T[] } | { ok: false; error: string };

// Structural on purpose, rather than importing PostgrestResponse: it accepts
// any supabase-js query (table reads and `.rpc()` alike) and lets a test hand
// in a plain object literal.
type CountedResponse = {
  data: unknown[] | null;
  error: { message: string } | null;
  count: number | null;
};

/**
 * Await a supabase query and refuse the result unless it came back whole.
 *
 * `what` names the data in the caller's own words — it lands in the message a
 * person reads, so write it to complete "Only read 1,000 of 4,312 …".
 *
 * The query MUST be built with `{ count: "exact" }`, and must not carry a
 * `.range()` or `.limit()` — a deliberately bounded read has nothing to verify.
 */
export async function readComplete<T>(
  what: string,
  query: PromiseLike<CountedResponse>,
): Promise<CompleteRead<T>> {
  const { data, error, count } = await query;

  if (error) return { ok: false, error: `Could not read ${what} (${error.message})` };

  const rows = (data ?? []) as T[];

  // No count came back, so completeness can't be established. Treating that as
  // success would defeat the whole point of routing the read through here — the
  // one thing this function must never do is claim a read is whole when it
  // doesn't know.
  if (count === null)
    return {
      ok: false,
      error:
        `Could not confirm that ${what} was read in full, so this was stopped ` +
        `rather than run against a possibly partial view of your data.`,
    };

  if (rows.length < count)
    return {
      ok: false,
      error:
        `Only read ${rows.length.toLocaleString()} of ${count.toLocaleString()} ${what}. ` +
        `Supabase returns at most 1,000 rows per read, so this was stopped rather than ` +
        `run against incomplete data. Raising "Max rows" in the Supabase Data API ` +
        `settings is the immediate fix.`,
    };

  return { ok: true, rows };
}
