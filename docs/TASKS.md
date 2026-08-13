# Tasks & Sprints

## Gantt Overview
```
Week 1  |-- Sprint 1: DB --|-- Sprint 2: Sign-up engine (v1 ✅) --|-- Sprint 3: Dashboard --|
Week 2  |-- Sprint 4: Lock it down --|-- Sprint 5: Loyalty & engagement --|
```

---

## Sprint 1 — Database Foundation
**Goal:** All tables exist, RLS is on, demo data is queryable.

- [ ] Apply migration SQL to Supabase project
- [ ] Confirm `customers`, `transactions`, `signup_events`, `engagement_logs` tables created
- [ ] Confirm 4 demo customers + 5 transactions + 4 signup_events seeded
- [ ] Confirm open v1 RLS policies active on all tables
- [ ] Screenshot Supabase table editor showing seed rows

**Definition of Done:** Running `select * from customers` in Supabase SQL editor returns 4 rows with no errors.

---

## Sprint 2 — Customer Sign-Up Engine ✅ v1 functional milestone
**Goal:** A real person can sign up; their data hits the database; WhatsApp opens.

- [ ] Homepage (`/`) renders sign-up form with fields: first_name, last_name, phone, email, whatsapp_opt_in
- [ ] Submit button inserts into `customers` + `signup_events` via Supabase client
- [ ] Loading spinner shown during insert
- [ ] Success state: "You're in! Check WhatsApp." message shown
- [ ] Error state: "Something went wrong — please try again." shown on Supabase error
- [ ] Empty/invalid form: inline validation before submit (phone required)
- [ ] If `whatsapp_opt_in = true`: open `wa.me/BUSINESS_PHONE?text=Hi+rice-mice!` in new tab
- [ ] Verify new row in Supabase `customers` table after test submission

**Definition of Done:** Fill in the form, click Submit, see success message, open Supabase — row exists with correct phone and `whatsapp_opt_in` value.

---

## Sprint 3 — Business Dashboard
**Goal:** Staff can see sign-ups and log transactions without logging in (demo mode).

- [ ] `/dashboard` page: sign-ups table (name, phone, opt-in, signed-up date)
- [ ] `/dashboard` page: transactions table (customer name, item, amount, date, staff)
- [ ] Empty state: "No sign-ups yet. Share your QR code!" when table is empty
- [ ] Loading skeleton on both tables
- [ ] "Add Transaction" form: select customer, item description, amount, payment method → inserts to `transactions`
- [ ] New transaction appears in table without page reload
- [ ] Verify adding a transaction reflects in the Supabase `transactions` table

**Definition of Done:** From `/dashboard`, add a transaction for a demo customer → it appears in the table immediately and persists on page refresh.

---

## Sprint 4 — Lock It Down (Auth + RLS)
**Goal:** Dashboard is gated behind staff login; public form stays open.

- [ ] Enable Supabase Auth; create one staff account via Supabase dashboard
- [ ] `/dashboard` redirects unauthenticated visitors to `/login`
- [ ] Login page: email + password → Supabase Auth session
- [ ] Replace v1 open RLS policies with `auth.uid() = user_id` owner-scoped policies
- [ ] Public sign-up form at `/` remains accessible without login
- [ ] Confirm no Supabase `service_role` key in any client-side bundle (check Network tab)
- [ ] Test: logged-out user cannot read `customers` rows via Supabase JS client

**Definition of Done:** Visiting `/dashboard` while logged out redirects to `/login`. After login, dashboard loads. Supabase query from browser console without session returns zero rows.

---

## Sprint 5 — Loyalty Scoring & At-Risk Flagging
**Goal:** Staff can see which customers are engaged and who needs re-engaging.

- [ ] `loyalty_score` computed in dashboard query: `(tx_count * 1) + floor(total_spend / 10000)`
- [ ] Score displayed on each customer row
- [ ] "At Risk" badge shown for customers with `last_purchase_date < now() - 30 days`
- [ ] Dashboard sort: highest loyalty score first
- [ ] `last_purchase_date` updated on each new transaction insert
- [ ] Verify At Risk badge appears for Sipho Dlamini (seeded 40 days ago)

**Definition of Done:** Dashboard shows at least one "At Risk" badge on seed data, loyalty scores are non-zero for customers with transactions, and scores update after a new transaction is added.
---

## Sprint 45 — Customer CSV import (preview → commit)
**Goal:** A real café loads its existing customer list and can segment on it immediately — without ever inflating consent or creating duplicates.

Facts this builds on (verified — don't re-derive):
- Unknown CSV columns become `custom_fields` rows + values in `customers.custom_fields`, and `buildFieldRegistry()` (`lib/segments.ts:491`) already compiles those into segment criteria identical in shape to the built-ins. **No segmentation code changes.**
- `custom_fields` is unique per `(business_id, key)` since 0017, `business_id` defaults to `current_business_id()`, and `unsubscribe_token` auto-generates. Nothing to add for multi-tenancy.
- `normalizePhone()` (`lib/providers.ts:277`) is the existing phone normaliser — reuse it for match keys rather than writing a second one.

- [x] Migration `0022_import_batches.sql`: `import_batches` (id, business_id, kind `customers`|`orders`, filename, row_count, created_by, created_at) + nullable `customers.import_batch_id`. RLS per the uniform 0017 pattern.
- [x] `lib/csv.ts` — RFC4180 parser (quoted cells, embedded commas/newlines/escaped quotes), the read side of the quoting rules `profilesToCsv` already writes (`lib/segmentExport.ts:5`)
- [x] `lib/customerImport.ts` — pure and testable: header auto-detection → column mapping → per-row validation → match-key computation. No I/O.
- [x] **Consent floor:** an opt-in is `true` ONLY when its mapped column is explicitly truthy (`yes`/`true`/`1`/`y`). Missing column, blank, or unrecognised value → `false`. No UI path may bulk-set opt-in to true.
- [x] **Dedup:** match existing customers on normalized phone, then lowercased email. Each row resolves to `create` | `update` | `skip`; the user picks the match policy once, in the wizard.
- [x] **Preserve the original signup date:** map a `signed_up`/`member_since`/`created_at` column onto `customers.created_at` (a plain `default now()`, no trigger — an explicit insert value wins). Fall back to the earliest imported order date, then to now(). Without this every imported customer looks like they signed up on import day, which breaks the `signed_up` criterion, new-customer reports, the growth chart (one fake spike), and the Customer 360 timeline anchor (`lib/customer360.ts:141`).
- [x] Route `/dashboard/customers/import` — four steps: upload → map columns → preview → commit. Gated on the `customers` permission.
- [x] Mapping step offers each unknown column as a new custom field with a value-type picker (text/number/boolean/date), or as ignored.
- [x] Preview step shows counts before anything is written: N create, N update, N skip, N rows with errors, N opted-in — and explicitly, how many defaulted to opted-out — plus the first 10 mapped rows.
- [x] Commit writes in chunks, stamps `import_batch_id`, writes `signup_events` with `source = 'csv_import'` (so "was imported" stays derivable — no new customer column), and one `audit_log` row.
- [x] Import button on `/dashboard/customers` + in its empty state.
- [x] Extend `tests/consent.test.ts`: no opt-in column → every imported customer opted out; ambiguous values (`maybe`, `1.0`, `TRUE `, `Y`) resolve safely; assert no code path can set an opt-in from a default. This is red-team gate item 5 (consent bypass) — a bulk import is exactly that vector.
- [x] `tests/customerImport.test.ts`: dedup matching, re-importing the same file creates zero new customers, malformed rows are rejected rather than silently coerced.

**Definition of Done:** Upload a 200-row café export with no opt-in column → preview reports 200 create / 0 opted-in → commit → all 200 appear in Customers, every one opted out, a segment built on an imported custom field returns the correct count, and re-running the identical file creates zero new rows.

**Closed by Sprint 46.** (Was: imported customers have no orders, so `stageOf()` puts every one in "New" and behavioural segments stay empty; the Import entry point does not ship to nav until 46 is in.)

---

## Sprint 46 — Order history import (makes the behaviour real)
**Goal:** Imported customers carry their real purchase history, so lifecycle stages, at-risk detection, and the analyst are correct on day one.

Why order history rather than seeded baseline columns: importing real orders makes every derived field genuinely correct — `orderCount`, `totalSpentCents`, `avgOrderCents`, `lastVisit`, `favouriteItem`, `itemsPurchased` all fall out of the existing `buildProfiles()` (`lib/segments.ts:101`) with **zero changes** — and it leaves the "points are derived, never stored" invariant (DECISIONS Sprint 29 Q1) untouched. Baseline columns could not produce average order or favourite item at all.

- [x] Migration `0023_order_import_ref.sql`: `orders.import_ref text` + a unique index on `(business_id, import_ref) where import_ref is not null` — the idempotency key.
- [x] `lib/orderImport.ts` — pure: map CSV → order rows + line items. Customer refs resolve by normalized phone / lowercased email against existing customers; unresolved refs are reported in the preview, never silently dropped.
- [x] Idempotency key: the CSV's external order id when present, else a stable hash of (customer, timestamp, total, item) — stored in `import_ref`.
- [x] Item matching: match `item_name` against the `items` catalog; keep unmatched names as free text (`order_items.item_id` is nullable and `item_name` is not), so "ever bought" and "favourite item" criteria work immediately without polluting the menu.
- [x] Status mapping: default `completed`; a mapped status column may set `cancelled`. Only `completed` feeds `buildProfiles`, which is already the case.
- [x] Commit writes `orders` + `order_items`, updates `customers.last_purchase_date` to the newest completed order, stamps `import_batch_id`, and writes one `audit_log` row.
- [x] Wire as step 2 of the same wizard — optional, but prominently offered after a customer import — and as a standalone entry for shops importing history later.
- [x] Post-import summary shows the journey-stage breakdown (New / Active / Loyal / At risk / Churned) so the café can see the history landed correctly.
- [x] `tests/orderImport.test.ts`: re-importing the same file creates zero new orders; `buildProfiles` returns correct totals/avg/favourite/last-visit for a fixture; `stageOf` classifies an imported lapsed customer as at-risk or churned, not "New".
- [x] Ship the Import entry point in nav once both sprints are in.

**Definition of Done:** Import 200 customers plus their 1,800 historical orders → the Customers list shows real spend and last-visit dates, the journey breakdown is no longer 100% "New", an "at risk" segment returns a non-zero count that matches a hand-check, and re-running both files changes nothing.

**Shipped beyond the list, because the list left a trap:** undo for order imports. Sprint 45 built undo for customers and the two share one history panel, so an order import with no way back meant a mis-mapped 300-receipt file could only be reversed with a DB script. Order undo deletes the batch's orders (`order_items` cascades) and then RECOMPUTES `customers.last_purchase_date` from the orders that remain — the prior value was never snapshotted, and recomputing is right whether the customer's real last visit predates the import, happened in the app since, or no longer exists.

**Two calls worth knowing about:**
- **Timezone is explicit.** A POS writes the shop's wall clock with no zone on it; reading "23:30" as UTC files that receipt under the next day in every report. The wizard defaults to the importer's own browser offset (they are standing in the shop) and the offset travels to the server, so preview and commit agree.
- **A receipt whose email and phone name two different customers is refused, not guessed.** Attaching it either way moves the wrong person's last visit, which can flip their lifecycle stage. Real exports carry these constantly (shared handsets, counter typos, recycled numbers) — 6 in the 330-receipt test file.

**Verified in production 2026-08-10** (migration 0023 applied, live browser run against a 594-row Square-shaped export):

- 594 rows → **330 receipts**, 0 parse errors, all 15 columns auto-mapped. The live preview matched an offline run of the same pure pipeline to the cent: 281 orders, 129 customers, $2,801.70, 6 conflicts, 34 walk-ins, 9 unresolvable refs, 20 cancelled.
- **Derived fields are right, including what they exclude.** A customer with 5 orders, one of them refunded: total and average count the 4 completed ones, favourite item comes from line quantities across a multi-line receipt, and the refunded receipt stays visible in the timeline without setting last visit.
- **Idempotency holds against the live database**, not just in tests — re-feeding imported receipts skipped them and let only a genuinely new one through.
- **Undo round trip is exact.** Removing the batch dropped revenue by precisely the amount the import reported, freed all 281 `import_ref` values, and left all 304 customers intact; re-importing restored the identical numbers. The `last_purchase_date` recompute was checked on both branches — to `null` when no completed orders remain, and back to the true previous order when some do.

**Known limit — closed by Sprint 47.** (Was: the import and its undo update `customers.last_purchase_date` one row at a time, and the import then recomputes profiles across the whole business for the done-screen breakdown. Measured at ~40s to import and ~25s to undo 281 orders touching 129 customers. That scales linearly and would risk the serverless timeout for a large shop, leaving a partial import behind since the writes aren't transactional.)

---

### Deliberately out of scope for 45–46
- **Baseline-column fallback** (`total_spent`/`order_count`/`last_visit` on the customer CSV) — superseded by order history. Revisit only if a real café turns up that can export customers but not orders.
- **Full duplicate/merge tool** — 45 does match-and-skip/update at import time; merging pre-existing in-app duplicates stays in the backlog.
- **Per-tenant order numbers** — imported orders consume the global `orders.order_no` identity, making a second shop's numbering more visibly non-1-based. Cosmetic, already in the backlog, unchanged by this work.

---

## Sprint 47 — Make the import survive a real shop's file
**Goal:** the order import stops scaling linearly in customers, and stops reporting success it didn't achieve.

Not planned in advance — this is the limit Sprint 46 measured and deferred, taken on immediately because the next thing a café does after a 281-order test is import all of it.

- [x] Migration `0024_import_last_purchase.sql`: three service-role functions, one statement each in place of a per-customer walk.
  - `import_touch_last_purchase(uuid, jsonb)` — moves `last_purchase_date` forward for a batch of customers. Replaces ~127 sequential single-row UPDATEs.
  - `recompute_last_purchase(uuid, uuid[])` — the same collapse on the undo path, reading the COMPLETED orders that remain after the deletes.
  - `customer_visit_aggregate(uuid)` — the done screen's stage breakdown, which used to select every customer, every order and every order LINE for the business and rebuild full profiles in JS to render five numbers.
- [x] **The forward-only rule moved into SQL.** "Old history must never rewind someone whose most recent visit was rung up in the app" now lives in the `WHERE` clause instead of a read-then-write in the action — which also closes a race, since an order taken between the read and the write can no longer be overwritten by a file of older receipts.
- [x] **Stage classification stays in TypeScript.** `customer_visit_aggregate` returns only `stageOf`'s two inputs, one row per customer, so thresholds keep a single definition and cannot drift between SQL and app code. Its `COALESCE` mirrors `buildProfiles` exactly.
- [x] Functions are service-role only and take the business id as an explicit argument, so the tenant fence lives inside the SQL rather than being trusted from a session. Deliberately NOT `security definer`: `service_role` bypasses RLS on its own, so invoker rights mean granting one to `authenticated` later could not turn it into an RLS hole.
- [x] Partial index `orders (business_id, customer_id, created_at desc) where status = 'completed'` — the shape both reads want, which the separate `business_id` and `status` indexes answered badly.
- [x] Both `rpc()` calls check their error, carry it out as a warning, and record it in the audit row.
- [x] `currentStages` returns `null` on a failed read instead of five zeros.
- [x] The wizard and the undo panel wrap their server action in try/catch.

**Definition of Done:** re-import and undo the 281-order file end to end, both RPCs clean at 129 customers, and the dashboard returns to the exact pre-test totals.

**Measured in production 2026-08-11**, same file, same 281 orders / 129 customers:

| | Before | After |
|---|---|---|
| Import | ~40s | **24s** |
| Undo | ~25–40s | **11.1s** |

Restored to exactly the pre-test baseline: 304 sign-ups, 278 completed orders, $4,177.07 — the revenue matches to the cent. Stage split (at 30-day at-risk): New 172 · Active 44 · Loyal 27 · At risk 32 · Churned 29.

**Two bugs, and they are the same bug.** Both were an error path that produced silence:

- **`recompute_last_purchase` referenced `latest.at`** where the subquery aliases the column `visited_at`. It would have thrown on *every* order-import undo. It installed cleanly and passed typecheck, build, and 141 tests — because none of them execute SQL, and a plpgsql body is only syntax-checked at `create or replace`; embedded identifiers resolve at execution. Only running it against a real database found it. (`LANGUAGE sql` functions, by contrast, ARE fully validated at creation — which is why `customer_visit_aggregate` could not have hidden the same mistake.)
- **Both `rpc()` results were discarded**, and then the server action's *rejection* was unhandled too. A failed undo reported "recalculated the last visit of every customer they touched" having done nothing, and a timed-out import left the wizard on "Importing…" with no message. That first state hides especially well: `stageOf` answers "new" at zero orders **without ever reading last visit**, so the badges look right while the field underneath points at a deleted order — and "at risk" is computed from exactly that field.

**Still open:** `tests/tenantIsolation.test.ts` greps `.from()` statements for a literal `business_id` and does not see `.rpc()` calls at all. All three functions carry the tenant fence in `p_business`, which that static guard cannot verify.

---

## Sprint 48 — Create customers from orders, and merge duplicates
**Goal:** a shop whose only export is a POS file can onboard, and the receipts the importer refuses stop being a dead end.

The two holes Sprint 46 measured and left open. They are one sprint because they need the same thing: a decision about whether two records are the same person.

Facts this builds on (verified against the migrations 2026-08-11 — `DATA_MODEL.md` is stale and describes the pre-tenant v1 schema, don't read it for this):
- Six tables hold a `customer_id`: `orders`, `signup_events`, `engagement_logs` (plain FK, no cascade), `journey_runs`, `journey_actions` (both `on delete cascade`), and `transactions`.
- `journey_runs` carries `unique (journey_id, customer_id)` — deliberate, from Sprint 7: one enrollment per customer per journey, ever, which is what makes the journey tick idempotent.
- `transactions` was created in 0001 and backfilled into `orders` by 0003. **Nothing in the codebase reads it** — no `.from("transactions")` anywhere. Its FK has no cascade, so it silently blocks any customer delete.
- The order import's gate already requires BOTH `customers` and `orders` permissions, so creating customers from a receipt needs no new permission.
- The wizard sends raw CSV text and the server re-runs the pure core, so a client-side "create this person" decision is display-only and cannot be smuggled past the server.

### Create from orders
- [ ] `lib/orderImport.ts`: a `create` outcome alongside `matched` / `conflict` / `walk-in`, gated on the row carrying a usable identity (a name plus a phone or email). Rows with a bare reference and no name stay walk-ins — a customer record with no way to contact them is worse than no record.
- [ ] **Consent floor holds.** A customer created from a receipt lands with every opt-in `false`. A POS export is proof of a purchase, never of consent.
- [ ] **`created_at` is the earliest receipt**, not import day (decided 2026-08-11). Their first order is a defensible member-since date; import day would put a fake spike on the growth chart and make the `signed_up` criterion useless on POS-only shops — the exact failure already logged against Klaviyo exports.
- [ ] `signup_events` row with `source = 'order_import'`, so "was imported, from a receipt" stays derivable without a new customer column — same shape as Sprint 45's `csv_import`.
- [ ] Stamp `customers.import_batch_id` (0022, already exists — the orders path just never set it).
- [ ] **Undo has to follow.** `undoOrderImport` deletes orders only; an orders batch that now also creates customers must remove those customers too, carrying over the customer undo's protection — never delete anyone who has ordered or been messaged since. Both halves in one batch, reported separately.
- [ ] Preview counts the new outcome explicitly: N attached, N customers to create, N conflicts, N walk-ins.

### Merge
- [ ] Migration `0025`: `merge_customers(p_business uuid, p_survivor uuid, p_absorbed uuid)`, plpgsql, service-role only, taking the business id as an explicit argument like 0024's three.
- [ ] **One function because it must be one transaction.** Repointing five tables and deleting a row over seven round trips has no transaction around it, and a half-finished merge is far worse than a half-finished import: orders on one record, messages on another, and no way to tell which. The function's implicit transaction is the whole point.
- [ ] Drop the dead `transactions` table in the same migration. Its data has lived in `orders` since Sprint 3 and its only remaining effect is to block deletes from a table nobody remembers.
- [ ] `journey_runs` collision: when both customers are enrolled in the same journey, keep the earlier `entered_at` and drop the other run rather than letting the unique key throw. Deliberate, because the alternative is a merge that fails for reasons the user can't see.
- [ ] `journey_actions` before the delete, not via the cascade — the cascade destroys the absorbed customer's action history silently.
- [ ] `lib/customerMerge.ts` — pure: given two customer rows, compute the survivor's merged field set. Tags union, `custom_fields` merged, earliest `created_at`, latest `last_purchase_date` / `last_contacted_at`, non-null contact fields preferred. No I/O, fully testable.
- [ ] **Opt-ins take the union** (decided 2026-08-11). If the absorbed customer opted in to a channel, the survivor inherits it. `signup_events` is repointed to the survivor, so the consent provenance moves rather than dying with the row, and the absorbed customer's full opt-in state is snapshotted into the merge's `audit_log` row before the delete.
- [ ] **Widen `tests/consent.test.ts` deliberately.** It asserts today that no code path can raise an opt-in from a default; the union is exactly such a path. Permit this one, and assert it can only fire from a genuinely opted-in source row — never from a blank, missing or unrecognised value. This is red-team gate item 5; letting the existing assertion fail silently would gut it.
- [ ] **Both ids proven in-business before anything moves.** Merge is the only operation that repoints rows across customer boundaries, so the survivor AND the absorbed id must be checked against the caller's business — checking only the survivor would let a crafted request pull another tenant's rows in.
- [ ] `unsubscribe_token`: the absorbed customer's token dies with the row, so anyone holding their unsubscribe link loses the ability to unsubscribe. Record the dead token in the audit payload so a support request can still be answered.
- [ ] Merge UI reachable from the customer list and from the import preview's conflict notes, gated on the existing `customers` permission (decided 2026-08-11 — no new checkbox, no roles migration).
- [ ] `tests/customerMerge.test.ts`: field-level merge rules, the journey_runs collision, and that a merge across two businesses is refused.
- [ ] **Exercise `merge_customers` against a real database before calling it done.** Sprint 47's `latest.at` bug passed typecheck, build and 141 tests because none of them execute SQL, and a plpgsql body is only syntax-checked at `create or replace`. This function is plpgsql and destructive.

**Definition of Done:** import a POS-only export into an empty shop → customers are created from the receipts, every one opted out, member-since dates come from their first order → merge two of them → orders, messages and signup events all land on the survivor, the journey enrollment doesn't throw, and undoing the batch removes both the orders and the customers it created while keeping anyone who has transacted since.

**Verified in production 2026-08-11** (migration 0025 applied, live browser run against an 8-receipt POS-shaped file using synthetic `sprint48.test` identities, so nothing in the shop's real data was touched):

- All 12 columns auto-mapped including the three new name targets. The live preview matched an offline run of the same pure pipeline exactly: **5 orders, 2 customers to create, $21.10**, with 2 receipts refused as ambiguous and 1 refused for having no name.
- **Both refusals fired on real data.** Two customers sharing one phone were refused rather than created, and the nameless receipt was left out — each with its own note naming the reason, not a generic "unmatched".
- **The union-find held.** A customer who appeared with email+phone, then email only, then phone only became ONE record with 3 orders, not three records.
- **Consent floor held.** Both created customers landed with WhatsApp, email and SMS all off; the Customer 360 page reads "Reachable: No — no marketing".
- **`merge_customers` ran clean on its first real call** — 4.6s, 3 orders moved. The survivor ended with all 5 orders, member-since moved back to the absorbed record's earlier first order (4/2 rather than 5/10), last visit stayed the later of the two, and the dropped phone, dropped email and dead unsubscribe link were each reported before the merge ran.
- **The arithmetic closes.** Dashboard went 304 → 305 sign-ups (two created, one absorbed), 278 → 283 orders, and $4,177.07 → $4,198.17 — the revenue delta is the import's reported $21.10 to the cent.
- **Undo removed both halves**: 5 orders plus the 1 remaining created customer (1, not 2, because the merge had already absorbed the other), returning the dashboard to exactly 304 / 278 / $4,177.07.

**Three copy bugs the live run found**, all invisible to the tests because they are strings: the done screen counted only pre-existing customers, so a POS-only import read "0 attached to 2 customers" when every order had landed on someone; and three counts said "1 receipts" / "1 customers". Fixed.

**The journey collision, verified separately 2026-08-11** — it only fires when both merged customers sit in the SAME journey, which the first run didn't cover. Probed deliberately via `scripts/sprint48/`: a *draft* journey (the tick reads only `status = 'running'`, so it can never reach a real customer) with the two test customers enrolled at different times and a pending action on each.

The merge was run in the harder direction on purpose — the survivor was the one who enrolled LATER, so the absorbed customer's run had to be the one that lived, which forces the survivor's own action to be moved off its run before that run is deleted. Afterwards: **1 run on the survivor, 2 actions, surviving run aged 10 days** (the absorbed customer's enrolment, not the survivor's 2-day-old one), 0 rows left for the absorbed customer, and every action still attached to a live run. No unique-key violation, and nothing lost to the `journey_actions.run_id` cascade — which was the specific failure the branch exists to prevent.

---

## Sprint 49 — The 1,000-row cliff

**Goal:** no page and no import can quietly work from half the data.

**The problem, in one line:** Supabase returns at most **1,000 rows** per API read, and nothing in this app checks whether it hit that ceiling.

There is no error when it does. The request succeeds, the body is just shorter, and every number worked out from it is wrong while looking completely normal.

**Where we stand today: nothing is broken.** 304 customers and 278 orders are both well under 1,000. But Sprint 46's own Definition of Done describes importing 1,800 orders — so the first café that uses the importer the way it was designed goes over the line immediately.

Facts this builds on (verified 2026-08-11 — don't re-derive):
- Max rows is **1000**, the Supabase default, never changed. Read from the project's Data API → Settings.
- The setting's own wording is "a view, table, **or function**" — so `.rpc()` results are capped too, not just table reads.
- Nothing in `app/` or `lib/` calls `.limit()`, `.range()` or paginates, apart from three cosmetic "recent activity" lists (12 and 20 rows).
- Supabase *can* tell us — asking for `count: "exact"` returns the true total alongside the rows. We just never ask.

### The four that matter

| # | Where | What goes wrong past 1,000 | Loud or silent? |
|---|---|---|---|
| 1 | `orderImport.ts:165` — existing customers | Importer can't see customers past #1000, so it won't match them. With "create customers" ticked it **makes a second record for someone already on file.** | **Silent** |
| 2 | `orderImport.ts:168` — existing `import_ref`s | Already-imported receipts look new, so a re-import tries to insert them again | Loud — the unique index from 0023 throws |
| 3 | `customerImport.ts:120` — existing customers | Same as #1, on the customer CSV path | **Silent** |
| 4 | `customer_visit_aggregate` (0024) | Returns one row per customer, so the done screen's stage breakdown is built from a truncated set | **Silent** |

**#1 is the one to care about.** Sprint 48 built merge to clean duplicates up; at 1,000 customers the importer starts creating them. Nothing catches it — `customers` has no unique constraint on phone or email, deliberately, because real shops have shared handsets.

Also affected, but not correctness-critical yet: eleven dashboard pages read `orders`, and four of them (`/dashboard`, `/dashboard/campaigns`, `/dashboard/segments`, `/dashboard/orders`) pull every order with every line item and rebuild profiles in the browser. Past 1,000 orders the totals go wrong there too — **that's Sprint 50**, because fixing it means changing how each page gets its data.

### Part 1 — make it loud (do this first)
- [x] `lib/supabase/readAll.ts` — one helper for reads that must be complete: ask for `count: "exact"`, compare it to the rows actually returned, refuse if they differ. A truncated read becomes a visible error instead of a wrong number. (Shipped as `readComplete`; Part 2 grew it into the paginating `readAll` and the refusal stayed underneath.)
- [x] Route all four reads above through it. Every silent case in the table is now a loud one.
- [x] `tests/readAll.test.ts` — 10 cases, including the exact response a capped read produces (200, 1,000 rows, no error) and a genuinely empty table, which must still pass.

This half is worth landing on its own. Even if Part 2 slips, nothing can be quietly wrong afterwards.

**Two calls worth knowing about:**
- **A missing count is a refusal, not a pass.** If no count comes back the helper cannot tell a complete read from a capped one, and answering "fine" would reinstate the exact bug it exists to catch. It fails instead.
- **The unchecked ref read is now checked.** `refRows` in the order importer had no error branch at all — a failed read left `existingRefs` empty, which silently turns idempotency off and makes every receipt in the file look new. That was a second silent failure sitting in the same three lines.

**One thing to watch on the next live import:** `customer_visit_aggregate` is an `.rpc()`, and while `count` is a documented option there (it typechecks, and the option exists precisely for set-returning functions), whether PostgREST populates it for *this* function hasn't been seen against a real database yet. If it doesn't, the done screen's stage panel hides itself rather than showing wrong numbers — the Sprint 47 degradation, working as designed. The Max-rows-to-10 test below covers it.

### Part 2 — make it right
- [x] `readComplete` became `readAll` — same refusal underneath, but it now keeps asking for the next page until the rows add up. All four reads go through it.
- [x] `customer_visit_aggregate` (#4) pages the same way. Stage classification stayed in TypeScript — Sprint 47 kept `stageOf` there so the thresholds have one definition, and shrinking the result set by moving them into SQL would have undone that.
- [x] `tests/tenantIsolation.test.ts` now scans `.rpc()` calls too, and requires every service-role function call to pass `p_business`. Flagged "still open" since Sprint 47.

**Three calls worth knowing about:**

- **Paging advances by what arrived, not by what was asked for.** Request rows 0–999 against a project whose cap is 10 and you get 10; stepping forward by 1,000 would skip 990 rows per page. Stepping forward by the number actually received is also what makes the Max-rows-to-10 test below work at all — the same code path runs, just with more pages.
- **`.order("id")` on every paged read is load-bearing, not tidiness.** `.range()` over an unordered query lets Postgres return rows in a different order per call, which skips and repeats rows across page boundaries. Every paged read now orders by a unique column; the RPC orders by `customer_id`.
- **A count that changes mid-read is a refusal.** Rows written while paging shift the offsets underneath us, so earlier pages may have skipped or repeated rows. There's no safe way to stitch that back together, so it stops and says to try again rather than importing from a smeared snapshot.

**The rpc fence was verified by breaking it**, not by watching it pass: renaming `p_business` in one call made it fail with `app/actions/orderImport.ts:399 — admin rpc "import_touch_last_purchase" passes no p_business`, then it was put back. A static guard that has never failed is indistinguishable from one that matches nothing — which is precisely what this half of the scan was until now.

Also refused, deliberately: a table over 200,000 rows. Loading that into memory to match against it is the wrong design, and saying so beats issuing 200 round trips.

**Definition of Done:** temporarily set **Max rows to 10** in the Supabase dashboard, then run an order import, a customer import, and load the dashboard. Every affected path either returns complete data or fails with a message naming the problem — none of them return a plausible wrong number. Set it back to 1000 afterwards.

That trick is the whole reason this is testable: it reproduces the cliff at 10 rows instead of needing a shop with 1,001 customers.

**Verified in production 2026-08-12**, cap lowered to 10 for the run and restored to 1000 after:

- **The cap is real and invisible.** `GET /rest/v1/customers` answered `Content-Range: 0-9/304` — ten rows, HTTP 200, no error field. The count header was always there; nothing had ever read it.
- **`.rpc()` reports a count too**, which Part 1 could only assume: `customer_visit_aggregate` answered `0-9/304` under `Prefer: count=exact`. So the aggregate was genuinely capped, and it can genuinely be paged.
- **The import ran clean at a cap of 10**, roughly 60 sequential round trips to page 304 customers and ~281 import refs: preview 3 orders / 2 customers to create / $13.50, then committed. Success is the assertion — `readAll` refuses anything short, so completing at all proves it fetched every row.
- **The stage panel proves the RPC end to end**: 172 + 43 + 27 + 34 + 30 = **306**, the shop's 304 plus the two customers just created. A capped aggregate would have counted ten.
- **Consent floor held** on both created customers — WhatsApp, email and SMS all false — and `created_at` came from each one's first receipt (2026-04-02 and 2026-05-10), not import day.
- **Undo removed both halves** and returned the shop to exactly **304 customers · 278 completed orders · $4,177.07**, the revenue matching to the cent.

**A fifth read, and the live run is the only thing that could have found it.** The past-imports panel on `/dashboard/orders/import` read every order across every listed batch and tallied them per batch in JS. Capped at ten, all ten rows belonged to the Square batch — so the batch imported seconds earlier counted **zero**, rendered as "Undone", and **hid its own undo button**.

That is worse than a wrong number. The other four cases show bad data; this one removes the recovery path and states the opposite of the truth — an import you can still see, reported as already reversed. Past 1,000 orders it fires on a real shop.

Fixed by not fetching rows at all: `head: true` with an exact count, one small query per batch, which cannot truncate. Confirmed live — with the cap back at 1000 the button returned and the confirmation read "Remove 3 orders?".

**Still unbounded, and deliberately left for Sprint 50:** the same page ships every customer, every menu item and every import ref to the browser so the wizard can preview client-side. Those truncate at 1,000 too. They are display-only — the server re-runs the pure core before writing, so no wrong data can be committed — but the counts a person reads before deciding to commit would be wrong. The fix is for the preview to ask the server rather than receive the tables, which is a redesign, not a bound.

**Why this sprint and not a feature:** it's the same failure the last two sprints each found the hard way — Sprint 47's `latest.at` threw on a path nothing executed, Sprint 48's copy bugs were wrong strings no test read. This one is worse than both, because there's no error to catch at all. Every one of the three was invisible to a green test suite and visible within minutes of running the real thing.

---

## Sprint 50 — stop shipping the orders table to the browser

**Goal:** a page's payload stops growing with the shop's whole history, and no page computes a number from part of it.

Sprint 49 fixed the reads whose *correctness* depended on completeness. This is the display half: five pages read `customers` with `select("*")` and `orders` with `select("*, order_items(*)")`, both unbounded, ship all of it to the browser, and rebuild profiles there with `buildProfiles` (`lib/segments.ts:101`). Past 1,000 rows the same silent cap applies — revenue, stage split, at-risk counts and segment sizes all go quietly wrong.

### What the survey changed about the plan

Mapping the six pages against what their client components actually read turned up three things that rule out the obvious fix.

- **"Paginate everything" is wrong, and would be worse than the bug.** `CampaignComposer.approve()` writes one `engagement_logs` row per recipient held in memory and stamps `recipient_count` from that array's length. If the recipient list were display-paginated, a campaign would silently send to page one and record that as the whole audience. Same shape on the segments CSV export, which writes every matched customer, not the 30 on screen. **Those pages need the complete set — what they must stop needing is the raw orders behind it.**
- **Only two of the six genuinely need order ROWS.** The dashboard's order table and the order pad's active queue render one row per order and link to it. The other four collapse every order into per-customer aggregates and never render one — segments, campaigns, the composer, and campaign detail.
- **One sort key lives outside the database.** The dashboard's sign-ups table is ordered by loyalty score, derived from completed order count and spend. Paging `customers` by `created_at` would quietly turn "most loyal first" into "newest first" — the same page, a different answer.

### Part 1 — the aggregate, proven before anything is wired to it
- [x] Migration `0026_customer_profile_aggregate.sql` — one row per customer instead of one row per order line: count, total spend, average, newest completed order, favourite item, items purchased, payment methods.
- [x] **Order level and line level are separate CTEs.** Joining `order_items` into the same aggregate multiplies each order by its line count, inflating both the count and the sum — silently, and only for multi-line receipts.
- [x] **`lastVisit` is deliberately NOT computed here.** `buildProfiles` resolves it as `last_purchase_date ?? newest completed order`, and `last_purchase_date` is a maintained column the caller already holds. Returning the raw newest order keeps that rule in one place — the same reasoning that kept `stageOf` in TypeScript in Sprint 47.
- [x] **`SECURITY INVOKER`, granted to `authenticated`** — and the fence works differently from 0024's three. Those are service-role only, so `p_business` *is* the tenant boundary. This one is called by the dashboard's RLS-scoped client, so RLS is the fence and `p_business` only narrows the scan. Do not "optimise" it into a security definer.
- [x] Covering index on `order_items (order_id, item_name) include (quantity)` — the line-level CTE had only `order_id` to work with.
- [x] `tests/profileAggregate.parity.test.ts` — the SQL must agree with `buildProfiles` exactly, because segment membership and every campaign audience are computed from these numbers. Nothing in `tests/` executes SQL (Sprint 47), so it compares a real dump of the function's output against `buildProfiles` re-derived over the same rows, field by field, naming any drift.
- [x] `scripts/sprint50/dump-parity-data.sh` produces that dump and **refuses to write a truncated one** — a short dump would compare two partial sets and pass, which is precisely the bug being chased.
- [x] The dump is gitignored. It is real customer names, phones and emails.

**Two known, deliberate differences from `buildProfiles`:**
- **Favourite item ties break alphabetically.** `buildProfiles` breaks them by Map insertion order, which follows whatever order the caller passed its orders in — so today's answer for a tie is *unspecified*, not merely different. The parity test allows a divergence only where both items have exactly equal quantity, and fails on anything else.
- **`itemsPurchased` and `paymentMethods` come back sorted** rather than in first-seen order. Every consumer does a membership test, so this carries no meaning — the parity test compares them as sets, which would still catch a missing item.

### Part 2 — done, and smaller than planned
- [x] `lib/segments.ts` gains `profilesFromAggregate`, sharing the customer half of a profile with `buildProfiles` so the two paths cannot drift. 5 unit tests, unconditional.
- [x] **Segments and the campaign composer** read `customer_profile_aggregate` instead of the orders table. Neither renders an order, so the whole orders read is gone from both. Both still load the COMPLETE set via `readAll` — the CSV export writes every matched customer and `approve()` stamps `recipient_count` from the array it holds.
- [x] **`lib/loadFindings.ts`, the campaigns list and campaign detail** get `readAll` instead. They keep the raw orders read, because they need it.
- [x] The nav badge wraps `loadFindings` in try/catch. It now throws on truncation, and a decoration must not take every dashboard page down with it.
- [x] `ponytail:` in `loadFindings` rewritten to name the real ceiling.

**The aggregate helped less than the plan assumed, and that is the finding.** Three of the five consumers genuinely need individual order rows:

| Consumer | Why raw orders |
|---|---|
| `loadFindings` | `buildReport` windows them by date; `pointsByCustomer` needs LIFETIME totals including `reward_points_spent`, which the aggregate does not carry |
| campaigns list | `CampaignsHome:163` passes them to `attributeCampaign` |
| campaign detail | same, plus per-recipient badges |

Pointing those at the aggregate would have added a query and still needed the orders. So they got the other half of Sprint 49's fix — completeness — rather than the aggregate.

**I got the upgrade path wrong twice in one session, the same way both times.** The original `ponytail:` named speed as the ceiling; I replaced it with "bound the orders read to the widest window findings use", which is also wrong, because `pointsByCustomer` is lifetime and a 30-day window would understate every loyalty balance. Caught only by reading `findings.ts:262` before writing the code. A `ponytail:` ceiling is a claim about the future and deserves the same suspicion as any other claim — including one written ten minutes ago.

**Verified live 2026-08-13:** segments renders 172 + 43 + 27 + 33 + 29 = 304 with "VIP spenders 3" (spend criteria intact); the composer reports 4 will receive · 300 excluded = 304 with WhatsApp 4 / Email 183 (every profile still carries its opt-ins and contact fields); the campaigns list and detail both still compute attribution — 1 of 4 sent, came back 1 (100%), $30.00.

### Part 3 — done, and deliberately not what it said
- [x] `readAll` on the four reads whose correctness depends on completeness: the dashboard's customers and orders (every stat card, the at-risk badge), the order pad's customer picker, and the order pad's all-orders projection — which is the loyalty points roll-up, lifetime by definition, so it can only be completed, never windowed.
- [x] A `ponytail:` on the dashboard naming the ceiling that remains.
- [ ] Server pagination, the loyalty sort in SQL, and stat cards as one SQL row — **not built, on purpose.** Parked in `BACKLOG.md` as a trigger on the largest tenant's customer count, not a scheduled task.

**Why the plan was dropped.** Part 3 was written as server pagination plus a migration moving the loyalty sort into SQL. The measured problem is silent wrongness at 1,000 rows; nobody has seen a slow page load. Pagination would mean a migration, a new sort path, and a UX change from instant client-side paging to server round trips — to fix something not yet observed. The dashboard still ships every customer and order to the browser, because that is exactly what its client-side sort, search and 25-row pager operate on. The `ponytail:` names the trigger: when a page load measurably drags, paginate and move the loyalty sort into SQL in the same change, since it is derived from order count and spend and cannot be paged from `customers` alone.

Left alone on purpose: the active-order queue and the menu-item read are bounded by what a shop can physically have open, and the history read already carries `limit(12)`.

**Verified live 2026-08-13:** the dashboard reads 304 sign-ups, 0 active, 278 completed, $4,177.07 — the exact baseline — with at-risk 33 and new 172 matching the segments page and the loyalty sort intact (429, 210, 138, 123). The order pad renders its menu, an empty active queue and the 12-row history.

**Definition of Done:** same trick as Sprint 49 — set **Max rows to 10**, then load every dashboard page and confirm each shows the same numbers it shows at 1000. Plus: send a campaign to a segment of more than one page's worth of recipients and confirm `recipient_count` matches the real audience.

**Verified in production 2026-08-13** (migration 0026 applied; dump taken, compared, then deleted):

- The function returns **one row per customer, 304 of 304** — no fan-out from the line-level join, which was the trap the two-CTE shape exists to avoid.
- **All five parity checks pass against real data**: order count, total spend and average; last visit including the `last_purchase_date` fallback; items purchased and payment methods as sets; and favourite item, which matched **exactly** on all 132 customers who have orders — 102 of them holding more than one distinct item, so the tie-break path was genuinely exercised rather than trivially satisfied. Zero tie divergences, so the one difference the test was willing to tolerate never arose.
- **The arithmetic closes independently of `buildProfiles`.** The aggregate reports 272 orders / $3,651.07. The raw dump has 272 completed orders carrying a customer id worth exactly $3,651.07, plus 6 completed walk-ins worth $526.00 — together the $4,177.07 the dashboard shows. The aggregate excluding walk-ins is correct: `buildProfiles` skips `!o.customer_id` (`lib/segments.ts:116`), and a walk-in belongs to nobody's profile.
- The dump was deleted afterwards and the parity tests are skipping again, which is the intended resting state — they are a harness to re-run after any change to the aggregate or to `buildProfiles`, not a permanent fixture.

**Getting 0026 into the SQL editor took three attempts, and the first two diagnoses were wrong.** The paste kept arriving truncated, so Postgres hit EOF before the closing dollar tag and reported "unterminated dollar-quoted string" against a file that was valid. It was not the apostrophes in body comments (attempt two cut at a line with no semicolon at all) and not a fixed size limit (the two cuts landed at different offsets, 4584 and 5102 bytes, leaving different remainders). What worked was making the file small enough that it could not be cut: 6,901 characters down to 3,026, with the design notes living here instead. **Keep migrations short.** The reasoning belongs in this file, where nothing has to paste it.

**Nothing is wired to the aggregate yet**, so the running app is unchanged. Part 2 is the next step.
