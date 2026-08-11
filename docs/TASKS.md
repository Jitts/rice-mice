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
