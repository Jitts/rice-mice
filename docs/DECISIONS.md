# Build decision log

Questions that came up while building, answered by research/testing rather than
by asking — with the reasoning, and what was built or deferred. Newest sprint first.

## Sprint 9 — marketing segmentation (Pass A)

Scope was set *with* the user this time (they explicitly invited a questionnaire):
a **desktop** visual-canvas builder (not touch), all eight criteria families,
channel-agnostic sending **deferred to Pass B**, and **consent + unsubscribe now**.
The design was argued through four personas (growth marketer / UX / shop owner /
engineer); the questions below are the engineering calls made from that.

### Q1. One big feature, or phased? — **Pass A (segmentation) now, Pass B (campaigns) next.**
Segmentation delivers value on its own: who to target, live counts, CSV export.
Sending adds provider keys, unsubscribe enforcement, a message log, and per-send
human approval — a bigger, riskier surface. Shipped A first and stopped for
review, matching the `AGENTIC_LAYER` "draft → approve → execute" gating (bulk
messaging a segment is flagged there as high-risk, explicit-approval-only).

### Q2. Segment logic in SQL or the client? — **Client, over data already loaded.**
`buildProfiles()` folds completed orders into a per-customer profile (spend,
order count, recency, favourite item, items ever bought, payment methods, tags,
birthday); the AND/OR tree evaluates in memory. No materialised membership to
keep in sync, no new query surface, and counts recompute instantly as criteria
change. **Verified against live data:** engine counts equal an independent SQL
computation (New this month 5=5, VIP 0=0, Regulars 0=0; journey sums to 5).

### Q3. Consent model? — **Per-channel opt-in + a token-scoped unsubscribe.**
`whatsapp_opt_in` already existed; added `email_opt_in`. "Reachable" = opted in
on ≥1 channel, and that drives the campaign preview count. Public
`/unsubscribe/[token]` flips both off through a `security definer` RPC — the only
consent-write path anon has. A direct anon UPDATE of consent is blocked by RLS.
**Verified:** anon direct update leaves the flag `true`; the RPC sets it `false`
for the matching token and returns `false` for an unknown one.

### Q4. Drag-and-drop scope? — **Palette-drag-to-add + within-group reorder; nesting via "add group".**
The user confirmed desktop-only, so the touch objections don't apply. Full
cross-group drag-move was deliberately left out (fragile, low payoff); nesting is
done by adding a nested group and dropping conditions into it. The drag payload
travels via `dataTransfer` so the criteria palette and the canvas (separate
components) interoperate.

### Q5. Where are tags maintained? — **Inline editor on the dashboard customer list.**
The Tag criterion would be a dead field with no way to set tags, so the sign-ups
table gained an add/remove tag cell (optimistic write, then persist). Seeded two
demo tags (VIP, Catering) so the criterion isn't empty on first open.

### Q6. Journey thresholds? — **Reuse the 30-day at-risk rule; add a 90-day churn cutoff.**
new (0 orders) → active (recent, <3 orders) → loyal (≥3, recent) → at risk
(31–90 days since last visit) → churned (>90). Mirrors the loyalty/at-risk rules
already in the app rather than inventing new ones.

**Security (binding DevSecOps — new surface: `segments` table, `unsubscribe` RPC,
consent columns):**
1. **Isolation — PASS.** anon SELECT `segments` = 0 rows; anon INSERT rejected (42501).
2. **SQL injection — PASS.** Names/definitions go through parameterised supabase-js;
   the RPC's `uuid`-typed parameter rejects non-uuid input, so injection is
   impossible, and a bad token returns `false`.
3. **Exfiltration — PASS.** No new secret reaches the client; unsubscribe uses the
   anon RPC and introduces no `service_role`.
4. **Consent tamper / brute-force — PASS.** anon cannot flip consent directly (RLS);
   only the token-scoped RPC can, and a 122-bit v4 token is infeasible to guess.

**Deferred to Pass B:** campaign composer, channel adapter layer (email first;
WhatsApp/Telegram/LINE pluggable), auto-appended unsubscribe link,
`engagement_logs`-backed message log, and per-send human approval.

## Sprint 8 — order detail and post-placement line editing

### Q1. Which orders can be edited after they're placed?
**Answer: Only active ones (open/preparing/ready). Completed and cancelled are
read-only.** Once an order is done or voided it's history — its line items and
total must not change, or receipts and loyalty totals would drift. The detail
page shows steppers and an "Add an item" grid while active, and collapses to a
plain read-only list with a "this order is {status} and can no longer be edited"
note once terminal. **Verified:** after completing an order the steppers and the
add-item section both disappear.

### Q2. Can an order be edited down to zero items?
**Answer: No — an order keeps at least one line.** Decrementing the last item's
quantity to zero is blocked with "An order needs at least one item. Cancel it
instead." A zero-line order is meaningless; cancelling is the correct way to void
it. **Verified** the guard holds on the last remaining line.

### Q3. How does the total stay correct through edits?
**Answer: Recomputed from the line snapshots and persisted on every change.**
Adding an item, changing a quantity, or removing a line each recompute
`sum(unit_price_cents × quantity)` and write it to `orders.total_cents` in the
same action. **Verified** against the DB: after a sequence of edits the stored
total (19800) and lines matched the UI exactly.

### Q4. New lines — live item price or a snapshot?
**Answer: Snapshot, same as placing an order.** Adding an item to an existing
order copies the item's current name and price into the line, so a later price
change or rename never rewrites an order that already includes it. Consistent
with how the order pad records lines at placement.

### Q5. The queue card had a Cancel button — where did it go?
**Answer: Replaced with an "Edit" link; Cancel now lives on the detail page.**
Three buttons (advance / cancel / edit) crowd a small touch card. The card keeps
the primary advance action plus an Edit link into the detail screen, and Cancel
sits one tap deeper on that screen — deliberately adding friction to a
destructive, irreversible action so it isn't hit by accident mid-rush.

## Sprint 7 — order status flow, loyalty rework, and self-completion

### Q1. Should the order queue sync across devices without a manual reload?
**Answer: Yes — via interval polling + refresh-on-focus, not Postgres realtime.**
Ground staff use this on multiple screens (a counter iPad places an order, the
kitchen tablet needs to see it). I first researched Supabase Realtime: the
`supabase_realtime` publication exists but is empty, so it would need
`alter publication supabase_realtime add table orders`. That is a persistent
change to shared production database state outside the git/Vercel deploy
pipeline, and it can't be QA'd multi-device in this environment. I chose a
12-second interval poll plus an immediate refetch on tab `visibilitychange`.
It needs no schema mutation, has no websocket lifecycle to leak, and converges
a second device within the poll window. **Verified:** changed an order's status
directly in the DB (simulating another device) and the open page reflected it
with no reload or interaction; a manual "Refresh" button and the active→history
migration on completion also confirmed.

### Q2. Should staff be able to edit an order's line items after it's placed?
**Answer: Defer to a later sprint. Not built.**
The original request was multi-item orders plus "the ability to change" — which
I read as changing *status* (built). Post-placement line editing (add/remove an
item, fix a quantity, recompute the total) is a distinct feature needing its own
order-detail screen and mutation path; bolting an editor onto the compact queue
cards would bloat them. For the common counter case — "wrong order, redo it" —
the Cancel action already covers it. A dedicated order-detail page is the right
home and belongs in Sprint 8.

### Q3. Should the active queue be separated from completed history?
**Answer: Yes. Built.**
A single "recent orders" list mixes what needs action with what's done. The pad
now shows an **Active queue** (open/preparing/ready, sorted oldest-first so the
longest-waiting order is first — FIFO) and a separate **Recent history**
(completed/cancelled, newest-first, capped). Terminal orders render without
action buttons.

### Q4. When does a customer earn loyalty / get their last-purchase stamped?
**Answer: On completion only. Built in the Sprint 7 core.**
Loyalty counts only `completed` orders — cancelled and in-progress orders earn
nothing — and `customers.last_purchase_date` is stamped when an order is marked
completed, which is what the At Risk flag keys off. **Verified** end-to-end: a
walk-in completion and a customer completion both behaved correctly.

### Q5. Should the dashboard also poll/realtime like the order pad?
**Answer: No. Left as server-fetch on load.**
The dashboard is a management view, not an operational surface staff watch during
service. Its loyalty roll-up recomputes from orders on each page load, which is
enough. Keeping it static bounds scope and avoids recomputing loyalty on a timer.

### Q6. Should the item catalog also sync to the pad in real time?
**Answer: No.**
The pad loads active items when staff navigate to it; the menu changes rarely
(not during a rush). Not worth a subscription or poll for near-static data.

### Q7. Payment method up front vs. at completion?
**Answer: Up front, at order placement.**
This matches the counter-service model in the design mockup (pay when ordering).
Sit-down "pay at the end" is a different flow and isn't in scope for v1.

### Q8. Global order numbers vs. daily reset? (settled in Sprint 6)
**Answer: Global, via a Postgres identity column.**
Race-free and simple. Daily-resetting numbers add complexity (per-day sequence,
timezone rollover) for cosmetic benefit; can be added later if wanted.

### Q9. Are the new tables safe per the binding DevSecOps rule?
**Answer: Verified — 3 pass, 1 noted.** (Full results in the section below.)

### Q10. The `customers.loyalty_score` DB column is now unused — a problem?
**Answer: No, but flag for cleanup.**
Loyalty is computed client-side from completed orders, so the seed column is
dead weight. Harmless (nothing reads it), but a future migration could drop it
or a trigger could maintain it if server-side loyalty is ever needed.

---

## Security verification (Sprint 7, binding DevSecOps checks)

Run against production Supabase. Tables under test: `items`, `orders`,
`order_items` (all staff-only: full access for `authenticated`, none for `anon`).

1. **Data isolation — PASS.** Anonymous SELECT on `orders`, `order_items`, and
   `items` each returns 0 rows; the same query with an authenticated staff token
   returns data (positive control). Anonymous INSERT into `orders` and `items`
   is rejected with HTTP 401. The isolation boundary here is role-based
   (anon vs. authenticated staff), by design — a single shop's staff share one
   dataset; there is no per-user partition to cross.
2. **SQL injection — PASS.** A filter of `name=eq.' OR '1'='1` returns 0 rows
   (literal match), not all 7 items. Inserting an item named
   `'; DROP TABLE orders;--` stores the string verbatim and the `orders` table
   remains intact (6 rows before and after). PostgREST/supabase-js parameterize
   all values.
3. **Data exfiltration — PASS.** The client bundle (`.next/static`) contains no
   `service_role` reference and no DB password; the only Supabase JWT shipped to
   the browser decodes to `"role":"anon"` (the intended public key). The
   `service_role` string appears only in the build cache and server bundle,
   neither of which reaches the client.
4. **Brute-force — NOTED (not app-code).** Eight rapid bad-password logins all
   returned HTTP 400 (invalid credentials) without a 429; Supabase Auth did not
   throttle within that burst. The email-send path *is* throttled (a
   `over_email_send_rate_limit` 429 was hit earlier during testing), so the
   rate-limit subsystem is active, but the password-grant threshold is higher
   than 8/burst. Recommendation: tighten the Auth rate limits in the Supabase
   dashboard (Authentication → Rate Limits). This is a service configuration,
   not something the application code controls.
