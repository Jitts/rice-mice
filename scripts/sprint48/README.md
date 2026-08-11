# Sprint 48 — live probes

Hand-run SQL for the one part of Sprint 48 the test suite structurally cannot
reach. **None of these are migrations.** They must never be copied into
`supabase/migrations/`, or a fresh database would come up carrying test data.

## Why they exist

`tests/` never executes SQL, and a plpgsql body is only syntax-checked at
`create or replace` — embedded identifiers resolve at execution time. Sprint 47
learned that the hard way: `recompute_last_purchase` shipped referencing
`latest.at` where the subquery aliased the column `visited_at`, and it passed
typecheck, a clean build and 141 tests because none of them ran it.

`merge_customers` (migration `0025`) is plpgsql and destructive. Most of it was
exercised by a real merge on 2026-08-11. The journey branch was not, because it
only runs when both merged customers sit in the **same** journey — so it gets a
deliberate probe.

## What the branch does

`journey_runs` carries `unique (journey_id, customer_id)` from Sprint 16 — one
enrollment per customer per journey, ever, which is what makes the journey tick
idempotent. Merging two customers who are both enrolled means one run must go.

The actions hanging off that run would go with it, because
`journey_actions.run_id` is `on delete cascade`. So the merge moves those
actions onto the surviving run **first**, and only then deletes the loser.
Losing the record of a message that was really sent is not an acceptable side
effect of tidying up a duplicate.

The run that survives is the one that entered **first** — it is the true start
of that person's time in the journey, whichever record it happened to be on.

## Running them

1. Import [`pos-only.csv`](pos-only.csv) at `/dashboard/orders/import` with
   **"Add the people this file names as customers"** ticked. Creates Test Alpha
   and Test Bravo.
2. Run [`01-seed-journey-collision.sql`](01-seed-journey-collision.sql).
   Enrolls both in one **draft** journey — `runJourneyTick` selects only
   `status = 'running'`, so it can never reach a real customer.
3. Merge Alpha **into** Bravo at `/dashboard/customers/merge`
   (survivor = Bravo, absorbed = Alpha).
4. Run [`02-verify-journey-collision.sql`](02-verify-journey-collision.sql) and
   check each column against the expected value in its header comment.
5. Run [`03-cleanup-journey-collision.sql`](03-cleanup-journey-collision.sql),
   then undo the import batch from `/dashboard/orders/import`.

Step 3 is deliberately the direction it is. Alpha enrolled 10 days ago and Bravo
2, so keeping Bravo makes the survivor the one who enrolled *later* — which
forces the harder branch, where the absorbed customer's run is the one that must
survive and the survivor's own action has to be moved before its run is dropped.

## Safety

Every identity is synthetic: `@sprint48.test` addresses and `+65 8100 000x`
phone numbers, none of which exist in real data. The probe journey is `draft`
and is deleted by step 5. The customers and orders come out via the import
undo — which is itself part of what Sprint 48 added, so removing them exercises
it.
