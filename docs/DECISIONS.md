# Build decision log

Questions that came up while building, answered by research/testing rather than
by asking — with the reasoning, and what was built or deferred. Newest sprint first.

## Sprint 27b — composer reflects connected providers

User feedback (screenshot, Telegram chip circled): connected Resend and
Telegram in Settings, but the campaign composer still showed "Telegram · not
connected". Root cause: the channel picker read a **hardcoded** `available`
flag on the channel registry (permanently false for SMS/Telegram/LINE) and
only received `emailReady` — it never looked at `channel_providers`. So a
provider connection could never reach it.

### Q1. Should connecting Telegram make it selectable for a campaign? — **No — reflect the connection honestly, but don't offer a channel that can't send.**
Telegram/LINE genuinely can't send a campaign yet: the bot can only message a
customer who has messaged it first, and we don't capture those chat/user ids
(the deferred "customer chat-id capture"). SMS (Twilio) has no manual mode and
isn't wired into campaign runs yet either. Making any of them selectable would
be a dead end — you'd pick it and reach "0 will receive this". So the fix
introduces a three-state model (`channelStatuses()` in lib/campaigns.ts):
- **ready** — can send today (WhatsApp/Email via manual deep-link; Email also
  direct when Resend is connected) → selectable, shows the recipient count.
- **connected_setup** — a provider IS connected but sending isn't possible yet
  → shown in amber as "· connected", **not** selectable, with a plain-English
  note on the chip AND a line under the picker saying why.
- **not_connected** — no provider, no manual mode → "· not connected".
Only ready channels are selectable, so the composer never offers a dead send.

### Q2. Where does the connection status come from without leaking keys? — **`connectedChannels()`, server-side, booleans only.**
A new server helper reads channel_providers via the service-role client and
returns just `{ email, whatsapp, sms, telegram, line }` booleans (enabled AND
fully configured; email also true via the legacy RESEND_API_KEY env fallback).
Only those booleans + labels/notes reach the browser — no key bytes. The
composer prop changed from `emailReady` to `channels: ChannelStatus[]`.

**Verification:** 50/50 unit tests on `channelStatuses` (every connectivity
combo; the invariant "selectable ⇒ ready"; the user's exact state email+telegram
connected). Dogfooded on a local prod build against the user's REAL connections
(their provider rows left untouched; staff login temporarily promoted, restored
after): the chips now read **WhatsApp · 2**, **Email · 1** (hint "Sends directly
from the app…" because Resend is connected), **SMS · not connected**, **Telegram
· connected** (amber, disabled, tooltip about needing chat ids), **LINE · not
connected**, plus an amber line "Telegram is connected, but campaign sending on
it isn't available yet." Selecting Email switched the hint to direct-send and
revealed the Subject field; the disabled Telegram chip ignored clicks.

## Sprint 28 — configurable marketing rules

The four thresholds the intelligence layer computes with — at-risk days,
churn days, loyal order count, attribution window — move from code constants
to Settings → Marketing rules (gated by the Business settings permission,
whose description now says so). Migration 0014 adds them to the
business_settings singleton with the shipped values as defaults, so nothing
changes until an owner edits them.

### Q1. How do the rules reach every engine without threading props through 20 components? — **One React context, provided by the dashboard layout.**
The layout already fetches business_settings for the brand; it now also
derives the rules and provides them via `RulesProvider`. `stageOf`,
`journeyCounts`, `buildSuggestions`, `attributeCampaign`, the CSV export and
the glossary all take a rules argument (defaulting to `DEFAULT_RULES`, so
unit tests and any missed caller keep the old behaviour), and client
components read `useRules()`. The glossary page went static → dynamic so its
quoted numbers always match the engines — the "definitions can never drift"
invariant now survives rules edits.

### Q2. What happens to saved segments when a rule changes? — **Nothing, deliberately.**
Suggestion-created segments bake the concrete numbers into the saved
definition (e.g. last_visit > 15 days). A later rules change doesn't silently
retarget an existing segment or campaign audience — the Settings card says
this out loud. New suggestions use the new numbers.

### Q3. Can the rules be saved into a nonsensical state? — **Two layers say no.**
The form validates bounds and the cross-field invariant (churn must exceed
at-risk, or a customer could be in two stages); the DB backs it with check
constraints including `churn_days > at_risk_days`, verified by attempting an
overlapping update straight at the database (rejected).

**Verification:** 41/41 unit tests (default-behaviour regression on every
stage boundary — 30/90/3/14 unchanged; custom-rules boundaries; journeyCounts
under both; win-back definitions bake rule numbers; attribution window
respected; glossary quotes custom and default numbers). Dogfooded on a local
prod build (staff login temporarily promoted, restored after): baseline
ribbon New 0 / Active 4 / Loyal 0 / At risk 1 / Churned 0 → saved 15/45/2/7 →
ribbon recomputed (a 2-order customer became Loyal: Active 3 / Loyal 1),
glossary page quoted 15/45/2/7 with zero stale defaults → overlapping values
(churn 10 < at-risk 15) blocked with a plain-English error → restored
30/90/3/14 through the same form (fields reopened showing the persisted
custom values first — round-trip proven) and the ribbon returned to baseline
exactly. Roles and the rules row confirmed back to the user's state in the DB.

## Sprint 27 — channel providers in Settings

Provider keys (WhatsApp / email / SMS / Telegram / LINE) move into
Settings → Channel providers: paste, enable, save, test — no Vercel or
Supabase visit. Migration 0013 + `lib/providers.ts` (catalog, masking, payload
builders) + `lib/providerConfig.ts` (server-only reads) +
`app/actions/providers.ts` + a Settings section gated by the `providers`
permission.

### Q1. Where do provider secrets live so "no user touches Supabase" holds? — **A table with RLS enabled and ZERO policies.**
`channel_providers` has row-level security on and no policies at all — the
anon and authenticated API roles can neither read nor write it, so keys never
transit the browser's database client in any form. The only path is the
service-role client inside server actions that first verify the caller's
`providers` permission. Proven from a real signed-in session: authenticated
SELECT → `[]`, anon SELECT → `[]`, authenticated UPDATE → matched 0 rows
(DB checked after — nothing changed). Considered Supabase Vault for at-rest
encryption; deferred — the keys already never leave the server, and Vault
would complicate the migration story for marginal gain at this scale.

### Q2. What does the browser see of a saved key? — **A fingerprint, never the value.**
Server actions and the Settings page return `maskSecret()` views
(`re_a…9fQx`); the full value has no round-trip. Editing works by omission:
a secret field submitted empty means "keep what's stored" (the server
merges), so the form never needs the original. Even the MASKED views are
fetched only when the caller holds the `providers` permission — a Staff-role
settings page contains zero provider strings (verified in the rendered HTML).

### Q3. Can the Test button be abused as an open relay? — **No — fixed content, saved credentials, permission-gated.**
The test sends a constant server-side message (`TEST_MESSAGE` /
WhatsApp's stock `hello_world` template) to a target the permission-gated
caller types; there is no content parameter. Telegram and LINE don't send at
all — their tests call the provider's identity endpoint (`getMe`,
`bot/info`) because real customer sends need per-customer chat/user ids that
the app doesn't capture yet (honest config-only status, noted on the cards).

### Q4. What happens to the old RESEND_API_KEY env path? — **DB wins, env still works.**
`getResendConfig()` reads the Settings row first and falls back to the env
pair, so nothing breaks for a deployment configured the pre-Settings way, and
the campaign/inbox `emailReady` gate now derives from the same helper.
WhatsApp Cloud API + Twilio SMS send adapters (payload builders, endpoints,
normalisation) are built and unit-tested, exercised today by the Test button;
wiring them into campaign runs waits for a real account — WhatsApp marketing
blasts legally require Meta-approved templates, and the template name is part
of the send, so shipping that path key-less would be a dead button.

**Verification:** 56/56 unit tests on the pure layer (masking boundaries,
phone normalisation, WhatsApp text/template payloads, Twilio params, endpoint
builders, per-provider validation, view masking, catalog sanity). Dogfooded
on a local prod build via the UI (staff test login temporarily promoted to
Owner, restored after): saved a fake Telegram token → card flips "Connected",
input self-clears, placeholder shows the mask → "Verify token" surfaced
Telegram's live "Unauthorized" → re-saved with the secret left empty and the
DB kept the exact token (merge proven) → WhatsApp card refused to enable with
a phone number in the Phone-number-ID field (clear error, nothing saved) →
fake Resend key saved: campaigns composer flipped to "Sends directly from the
app" with NO env var present (DB-driven gating proven) and "Send test"
surfaced Resend's live "API key is invalid". Bundle scan: zero key bytes in
client chunks. All provider rows reset to pristine and roles restored to the
user's arrangement afterwards. Noted: the user has created their own
staff account (jit staff) via the Sprint 26 Team page — untouched.

## Sprint 26 — in-app account administration

User request (screenshot of the Team page with the Supabase-instructions
card crossed out): show each member's email, edit it, reset passwords, and
add team members manually — no Supabase for anything. Powered by the
service-role key stored in Vercel env during Sprint 24.

### Q1. How does the admin API stay safe? — **Server actions that re-verify the caller, and a key that never leaves the server.**
`lib/supabase/admin.ts` builds the service-role client from server env only;
every action in `app/actions/team.ts` first resolves the CALLER's session
and requires the `team` permission before touching the admin API. The Team
page fetches emails/ban-status server-side and only for team-permission
callers — verified by fetching the page as a Staff-role user: the HTML
contains no other members' emails, no add form, no admin buttons. Bundle
scan: the only "SUPABASE_SERVICE_ROLE_KEY" string in client chunks is the
human-readable "not configured" notice; zero bytes of the key value.

### Q2. Create accounts with confirmation emails? — **No — owner sets a temporary password, `email_confirm: true`.**
A café owner standing next to their new hire doesn't need an email
round-trip: the account works the moment it's created, the owner tells them
the password, and they can change it themselves in Settings (Sprint 24's
self-service password change). Creation inserts the staff_profiles row
immediately (name + chosen role) rather than waiting for first login; if
the profile insert fails the auth user is deleted again — no half-created
logins. Email changes also use `email_confirm: true` for the same reason.

### Q3. Delete or deactivate? — **Deactivate (a real GoTrue ban), reversibly.**
Deleting an account would also delete its profile row while historical
orders/sends keep only the display-name snapshot — deactivation preserves
the identity trail and is reversible. Guards: you can't deactivate yourself,
and the last ACTIVE Owner can't be deactivated (complements Sprint 25's
last-Owner demotion trigger; this one lives in the server action since bans
are a GoTrue attribute, not a table row).

**Verification (full lifecycle dogfooded through the UI on a local prod
build, then cleaned up):** created temp.cashier@ricemice.co.za with a set
password and Staff role → signed in immediately, profile + role correct →
reset its password (old rejected, new accepted) → changed its email (new
email signs in) → deactivated ("User is banned" on sign-in) → reactivated
(signs in again) → account deleted via admin API; the disposable staff
test login was temporarily promoted to Owner to drive the UI and restored
to the user's own arrangement (Staff) afterwards. Pane note: full-page
loads don't hydrate in the dev pane (known rAF quirk) — all interactions
were driven after client-side navigation from a hydrated page.

## Sprint 25 — owner-defined roles & permissions

User decision: not fixed tiers — owners create their OWN roles. Migration
0012 + `lib/permissions.ts` + Settings "Roles & permissions" + role
assignment on the Team page. All three existing logins seeded as Owners
(user decision); new first-logins land in the editable "Staff" starter role.

### Q1. Can owners also invent new permissions? — **No — the catalog is fixed in code, roles are free-form.**
A permission is only real if code somewhere enforces it; a runtime-invented
permission would be a checkbox that does nothing. So the catalog (10 ids:
orders, menu, customers, segments, campaigns, reports, settings_business,
team, roles, providers) ships in `lib/permissions.ts`, and owners compose
catalog ids into named roles. The system Owner role stores `['*']` —
"everything, including future permissions" — so adding a catalog entry in a
later sprint never strands the Owner.

### Q2. Where is this enforced? — **Two layers, honestly separated.**
Feature access (nav items, Settings sections, send actions) is app-level:
the shell filters nav by permission, Settings hides/locks sections, and the
email server actions re-check `campaigns` server-side. But the ESCALATION
paths are DB-hard, in triggers and RLS that no client can bypass:
- writing the roles table requires the `roles` permission (RLS policies via
  a `security definer` `user_has_permission()` that distinguishes
  authenticated users from anon and from trusted server contexts);
- changing ANY role assignment — including your own — requires `team`
  (BEFORE UPDATE trigger), so self-promotion is impossible;
- a fresh profile INSERT can carry at most the default Staff role unless
  the inserter holds `team` (blocks bootstrap self-escalation);
- the system Owner role can't be edited or deleted; a role with members
  can't be deleted;
- the LAST Owner can never be demoted (checked in every context, trusted
  or not — verified inside a rolled-back transaction so no real account was
  ever left modified).
Documented boundary: fine-grained feature permissions are app-enforced;
RLS + triggers are the hard wall for anon vs authenticated and for the
RBAC core itself.

### Q3. What does "no role" mean? — **Deny by default.**
A profile without a role gets an empty permission set: Dashboard, Glossary
and My profile only. The Team page shows "no role (locked out)" in the
assignment dropdown so it's a deliberate state, not an accident.

**Verification (16/16 DB security checks + full UI loop):** anon sees/writes
nothing; an Owner created a custom role, demoted itself, and the demoted
account could NOT promote itself back, create roles, edit the Staff role, or
touch other profiles (while still editing its own display name); the system
Owner role rejected edit and delete; a role with members rejected delete;
the last-Owner guard fired on the final demotion inside a rollback tx.
UI loop on a local prod build: full 6-item nav as Owner → created "Front
counter" (orders+menu) in Settings → assigned self on the Team page → nav
collapsed to Dashboard/Order pad/Menu items, Business section locked, Roles
and Team sections gone, assignment dropdowns replaced by read-only text →
restored to Owner, test role deleted. **Testing incident, disclosed:** the
first UI assignment used a sloppy DOM selector and briefly demoted
js_tan_1991@hotmail.com instead of the test account — caught by checking
the DB immediately after the action and restored within a minute; the
retest anchored on the "you" badge. All three accounts confirmed Owner and
only Owner+Staff roles remain.

## Sprint 24 — Settings hub: profile, business identity, $ currency

First sprint of the Settings plan (user-approved: six-section hub, owner-made
roles, in-app account admin, provider keys in-app, editable marketing rules).
This one ships the shell plus the two sections with no admin-key dependency.

### Q1. Where does the sidebar's identity link go now? — **/dashboard/settings.**
The footer profile link points at Settings (My profile lives there: display
name + change password via `supabase.auth.updateUser` — a signed-in user can
change their own password with no admin key). The Team page stays reachable
through a Settings card until Sprint 26 absorbs it.

### Q2. Is business identity a secret? — **No — and it must be anon-readable.**
`business_settings` (migration 0011) is a singleton row (boolean PK with
`check (id)` — a second row is unrepresentable) holding shop name/emoji,
tagline, phone, address, receipt footer. The PUBLIC sign-up page renders the
shop name, so anon gets SELECT; only authenticated staff get UPDATE, and
there is no insert/delete policy for anyone. Provider keys will NOT live in
this table — they get a service-role-only table in Sprint 27. Consumers:
public homepage h1, dashboard shell brand (server layout → prop), receipt
header/tagline/address/phone/footer. Fallback defaults in `lib/business.ts`
mean a failed read can never blank the UI.

### Q3. Currency: hardcode $ or make it a business setting? — **A single exported constant, not a setting.**
User instruction: "for all price related use $ symbol". `CURRENCY = "$"` in
`lib/format.ts` feeds `formatCents` plus the offer label, segment-builder
money prefix, composer "$ off" option, items "Price ($)" label, and the
loyalty/offer glossary texts. Making it per-shop configurable would thread
settings through every pure engine for a value that changes ~never; if a
second currency is ever needed, the constant is the one place to lift.

**Setup done this sprint for Sprint 26:** the user supplied the Supabase
service-role key in chat; it was validated against the GoTrue admin API
(listUsers OK) and stored in Vercel env (`SUPABASE_SERVICE_ROLE_KEY`,
Production + Development, server-only). Not committed anywhere.

### Q4 (follow-up, user request). Show what the edits will look like. — **Live previews rendered from the unsaved form state.**
The Business section now shows a mock of the public sign-up page and a
sample printed receipt side by side, re-rendering on every keystroke —
before Save. The receipt preview reuses the REAL slip component
(`ReceiptSlip`, extracted from Receipt.tsx), so the preview can never drift
from what actually prints; its sample order includes a discount line so the
offer presentation is visible. Verified live: typed a new name/tagline/
phone/footer → both previews updated instantly while the sidebar (saved
state) stayed unchanged — the previews are draft-only, nothing is written
until Save.

**Security (binding DevSecOps — new surface: `business_settings`):**
1. **Isolation — PASS (by design, asymmetric).** anon SELECT = 1 row
   (intended, public identity); anon UPDATE affects 0 rows; anon INSERT =
   42501; even authenticated INSERT of a second row = 42501 (singleton).
2. **Password self-service — PASS.** Full round-trip on the disposable staff
   account: change → old password rejected → new password signs in →
   restored to original.
3. **Verified live** on a local prod build: renamed the shop in Settings →
   sidebar brand, public homepage (curl) and receipt all showed
   "🍚🐭 rice-mice deluxe" → restored; dashboard Revenue "$801.00" and
   receipt "$143.00" confirm the currency switch end to end.

## Sprint 23 — receipt printing (P5c)

`/dashboard/orders/[id]/receipt` — a thermal-slip-shaped (~80mm, 302px,
monospace) receipt with shop header, order no / date / time / staff /
customer, item lines, subtotal + discount (with the offer code) only when a
discount exists, TOTAL (the charged amount), payment method. "Print receipt"
button on the order detail header; Print button on the receipt calls
`window.print()`.

### Q1. How does printing skip the dashboard shell? — **A page-scoped `@media print` style, not shell changes.**
The receipt page ships a small `<style>` that hides `header`/`aside` and
strips `main` padding during print, plus `@page { margin: 6mm }`. Scoped to
the page it can't regress any other screen, and the shell needed no print
awareness at all. The on-screen toolbar (back link + Print button) is
`print:hidden`, so paper gets only the slip.

### Q2. Receipts for non-completed orders? — **Yes, honestly labelled.**
A cancelled order prints "*** CANCELLED ***"; an in-flight one prints
"— provisional (status) —". Kitchens hand slips to customers before
completion all the time; the label keeps the paper truthful. Discount math
mirrors the order pad exactly: lines are gross, the discount is the stored
snapshot, TOTAL is `total_cents` (charged) — the receipt recomputes nothing.

**Verification:** live on a local prod build against the user's real
completed order #13: 1× Side Salad R30.00 + 1× Rice Bowl (L) R85.00 +
1× Iced Tea R28.00 = TOTAL R143.00, paid by card — matches the stored
`total_cents`; no discount rows shown for a 0-discount order; print CSS and
Print button present. `tsc` + `next build` clean (route 1.47 kB). No new
tables/columns → no new RLS surface. Actual paper output (the browser print
dialog) can't be exercised in the dev pane — user should try Print in their
real browser.

## Sprint 22 — date-range sales reporting (P5b)

New `/dashboard/reports` page (sidebar: Reports) — presets (Today, Yesterday,
Last 7 days, This month, Last 30 days) + custom from/to; stat cards (Revenue,
Completed orders, Avg order value, Discounts given), a zero-filled revenue-by-
day bar chart, breakdowns by item / payment method / staff, an orders CSV
export, and a cancelled-orders footnote. All aggregation is a pure module
(`lib/reports.ts`), no migrations.

### Q1. Which timestamp does a report day use? — **When the order was PLACED, in the shop's local time.**
Orders have no completion timestamp (status flips in place), and at counter
pace placed-day = completed-day anyway. `<input type="date">` values are
parsed as LOCAL days (naive `new Date("yyyy-mm-dd")` is UTC midnight, which
shifts the day in UTC+ timezones like South Africa). Money still only counts
completed orders — the same rule as everywhere else. Documented as the
"Reporting day" glossary entry; per the Sprint 13 rule, all four new metrics
shipped with glossary entries + InfoTips in the same sprint (avg_order_value,
gross_item_sales, discounts_given, report_day).

### Q2. Can item sales just split revenue per line? — **No — item sales are gross, and labelled as such.**
An offer discounts the whole order (`total_cents` = charged,
`discount_cents` = snapshot), so a per-line "net" would be an invented
allocation. Top items shows line price × qty (gross); the glossary entry
says exactly why it can total slightly more than revenue when discounts
were given.

### Q3. Chart library? — **No — flex divs.**
One bar per day (height = revenue share, tooltip with the exact figures,
today highlighted, zero days dimmed) is a 20-line flexbox. React Flow was
justified by real interaction; a dependency for static bars isn't. Zero-fill
is capped at 366 buckets so an absurd custom range can't hang the page.

### Q4. What does the CSV export? — **Every order in the range, all statuses.**
It's a bookkeeping export, not a revenue number — cancelled/in-progress rows
are visible with their status so the export reconciles against the till.
One row per order: order_no, placed_at, status, staff, payment, items
summary, discount, total charged.

**Verification:** 25/25 unit tests (preset boundaries, inclusive range ends,
completed-only money, zero-fill, gross item merge, payment/staff grouping,
no-NaN empty range, CSV in/exclusion). Live check on a local prod build over
a full-2026 custom range matched independent SQL exactly: R801.00 / 8
completed / R100.13 avg / R0 discounts; top items Mice Curry Combo 3×R360,
Rice Bowl (L) 2×R170, Rice Bowl (S) 1×R65; 1 cancelled excluded; 365
zero-filled bars; staff split (Naledi, Thabo, "(no name)"). No new tables →
no new RLS surface (reads go through the existing staff-only orders policy).

## Sprint 21 — per-staff accounts (P5a)

P5's first slice: staff stop being an anonymous free-text name. One
`staff_profiles` row per auth user (migration 0010); the display name is what
gets stamped on orders (`staff_name`) and sends (`sent_by`).

### Q1. Can the app create staff accounts itself? — **No — and it shouldn't pretend to.**
Creating auth users needs the service-role key, which this project
deliberately keeps out of Vercel env (deployment-wide admin credential vs. a
counter app's blast radius). GoTrue's client `signUp` is the wrong tool too:
it swaps the current session and trips email-domain/confirmation rules (the
Sprint 11 lesson). So the Team page documents the real flow: owner adds the
user in Supabase → Authentication; the profile row auto-creates on their
first sign-in (dashboard layout upsert, race-safe via `ignoreDuplicates`),
named from the email prefix, editable on the Team page.

### Q2. Identity stamp: FK to the profile, or a text snapshot? — **Keep the existing text columns, prefill them from the profile.**
`orders.staff_name` and `engagement_logs.sent_by` already exist as text.
A `staff_id` FK would break on profile deletion and rewrite history on
rename; a snapshot records who *actually* did it at the time — same snapshot
philosophy as order_items prices and campaign segment definitions. The
"Staff" input on the order pad and "Sending as" on campaign runs stay
editable (one shared counter tablet ≠ one person) but now default to the
signed-in profile via a `StaffContext` provided by the dashboard layout.
Journey-inbox sends previously stamped no sender at all — now they stamp
`sent_by` too (client path from context; provider path resolves the caller's
profile server-side).

### Q3. Why no `role` column? — **Nothing enforces roles yet.**
A flag no code reads is a lie waiting to happen. It ships together with the
first role-gated feature (e.g. "only owners see reports"), not before.

**Security (binding DevSecOps — new surface: `staff_profiles`):**
1. **Isolation — PASS.** anon SELECT = 0 rows; anon INSERT = 42501.
2. **Cross-user tampering — PASS.** An authenticated staff member's UPDATE of
   another profile affects 0 rows (update-own policy); own update affects 1.
3. **Verified live** on a local prod build: sidebar footer shows the
   signed-in profile ("Staff") linking to /dashboard/team; Team page lists
   all 3 backfilled profiles with a "you" badge + the add-account note;
   rename → Save → `router.refresh()` propagated the new name to the sidebar
   and the order pad's prefilled Staff field; name then restored.

## Sprint 20 — real email provider (P4), env-gated

P4 from the priority queue: "wire a real channel provider". Blocked on the
user's API keys — so the sprint ships the entire integration behind an env
gate: with `RESEND_API_KEY` set in Vercel the email channel sends directly
from the app; without it, everything stays exactly the manual deep-link mode
that exists today. Setup steps for the user live in `docs/PROVIDERS.md`.

### Q1. Which provider first — WhatsApp (the shop's main channel) or email? — **Email via Resend.**
WhatsApp Business API requires Meta business verification, a registered phone
number, and template pre-approval — weeks of user-side process before the
first send. Resend is a free API key and optional domain verification; the
send is one HTTPS POST with no SDK (so no `npm install`, which also avoids
re-pruning the `--no-save` `pg` package). The channel registry
(`lib/campaigns.ts`) and the server send path (`app/actions/email.ts`) are
the two plug points when the user brings WhatsApp/SMS credentials later.

### Q2. Where does the send run, and what does the client get to say about it? — **A server action that trusts nothing from the client but a row id.**
`sendCampaignEmail(logId)` / `sendJourneyEmail(actionId)` re-load the row
server-side and send the **logged draft verbatim** (personalised body +
unsubscribe footer, composed at approval time). The client cannot pass
arbitrary to/subject/body — so an XSS or console user can't turn the action
into an open mail relay. Guards, in order: signed-in staff (`auth.getUser()`),
row exists and is unsent/pending, channel is email, and the customer **still**
consents (live `email_opt_in` read at send time, not the approval-time
snapshot). The API key is read only inside the action; a bundle scan confirmed
no `RESEND_API_KEY` in any client chunk (the only "resend" strings are
supabase-js's own `auth.resend()` internals).

### Q3. Does a provider make sending automatic? — **No — the staff click is still the send.**
Same AGENTIC_LAYER stance as manual mode: journeys and campaigns only ever
*prepare* drafts; a human clicks "Send email" (or "Send all remaining", which
is one explicit click for the visible queue, paced at ~650ms/send under
Resend's 2 req/s limit, stopping on the first failure so errors are seen, not
skipped past). The "mail app" deep-link remains as a per-row fallback even in
provider mode. Journey emails keep the generic default subject rather than
the journey's name — journey names are internal working titles ("Win back
lapsed VIPs") that shouldn't leak into a customer's inbox.

### Q4. What records the difference between a clicked deep-link and an API send? — **`engagement_logs.sent_via` (migration 0009).**
`'manual' | 'resend'` (CHECK-constrained), null on legacy rows. Attribution
and results are unaffected — a send is a send; `sent_via` is bookkeeping for
future delivery debugging ("did this actually leave via the API?").

**Verification:** 14/14 unit tests on the payload builder (address/body
validation, from/subject fallbacks, trimming). Live E2E on a local prod build
with a **fake** key: composed a real email campaign via the UI (segment "VIP
spenders" → Email · 1 reachable), approved it, run page rendered provider
mode ("Send email" / "Send all remaining (1)" / "mail app" fallback), clicked
send → Resend's real API rejected the key → "API key is invalid" shown inline
on the row, and the DB confirmed **no false bookkeeping** (`sent_at` null,
`sent_via` null, campaign not completed). Restarted without the key: same
campaign rendered pure manual mode (mailto deep-link + "Manual mode" hint).
Test campaign then deleted (cascade verified, only the user's real campaign
remains). `tsc` + `next build` clean; campaigns route size unchanged.

## Sprint 19 — integrate journeys and campaigns

User request: journeys and campaigns felt disjoint — a journey couldn't
target any saved audience. Scoped with a mockup + 3 confirmed answers:
segment-only triggers, Journeys folded into a unified Campaigns section
(tabs), journey sends measured through the same attribution engine.

### Q1. What was actually disjoint? — **Journeys reinvented a tiny targeting vocabulary instead of using the segment engine.**
The trigger only knew five fixed conditions (stage/no-visit/signed-up/
birthday/tag) — a small subset of what Segments already supported (custom
staff-defined fields, AND/OR nesting, merge/exclude via segment_ref). A
journey literally could not reach "VIP spenders" or anything with custom
criteria. That's the root of "not able to deliver to any of my audiences."

### Q2. Fix — **the trigger now stores `{segmentId, segmentName}` and re-evaluates the segment's LIVE definition every tick**, via the exact same `matchesNode`/`filterProfiles` functions Segments and Campaigns already use. `segmentName` is a display snapshot only (shown on the canvas node); matching always resolves the current segment definition, so editing a segment's criteria changes who a running journey enrolls — consistent with "evergreen" meaning genuinely live, not frozen at launch. A deleted segment matches nobody and blocks Launch ("The selected audience no longer exists — pick another"); no segment chosen blocks with "Choose an audience for the trigger." The old bespoke condition types are gone entirely — no journey existed in production to migrate.

### Q3. Navigation — **Journeys folded into Campaigns as a tab, Segments stays separate.**
`/dashboard/journeys` is deleted; `/dashboard/campaigns` now renders
`CampaignsHome`, a client tab switcher (One-time sends / Journeys) fed by
one consolidated server fetch. `?tab=journeys&segment=<id>` deep-links
straight to a new journey with that segment preselected — Segments gained a
"Create journey" button next to the existing "Create campaign" one, same
pattern. The sidebar drops from 6 items to 5.

### Q4. Measurement — **journey sends stamped with `journey_id` on `engagement_logs`, reusing `attributeCampaign` unchanged.**
Migration 0008 adds `engagement_logs.journey_id` (mirroring the existing
`campaign_id` column); ActionInbox's `resolve()` now stamps it on send. A
journey's own Results card (Sent / Came back / Revenue after send) computes
from logs scoped to that journey — the identical function and glossary terms
one-time campaigns use. Decided AGAINST creating a synthetic `campaigns` row
per message node (would have entangled evergreen journey steps into the
one-time campaigns list); offer-code redemption tracking for a journey
message that attaches an existing campaign's offer continues to show on
that offer-owning campaign's own results, not duplicated at the journey
level — a deliberately bounded scope, noted for a future pass if wanted.

**Verified:** 13/13 unit tests, including the load-bearing one — a two-condition
AND segment (`total_spent ≥ R500 AND last_visit > 30 days`, criteria the old
bespoke trigger could never express) correctly drove enrollment, proving full
segment power now reaches journeys. RLS re-confirmed on the new column (anon
0 rows / insert rejected). Full live E2E on production data: Segments →
"Create journey" on "VIP spenders" (2 matches) → landed on the Journeys tab
with the segment preselected on the trigger node → built and launched a
journey evergreen → the tick enrolled **exactly the 2 real VIP customers**
matching the segment's live count → inbox showed both drafts → sent one →
`engagement_logs` confirmed stamped with the real `journey_id` → the
journey's own Results card read "Sent 1" through the shared attribution
engine → all test rows deleted, cascade left 0/0/0, production data restored
exactly.

## Sprint 18 — fix: dragging and connecting nodes on the journey canvas

User report after trying the canvas in a real browser: no block stayed put
after dragging, and connecting nodes wasn't working. Root-caused and fixed.

### Q1. What was actually broken? — **The canvas re-derived its entire node/edge arrays from parent state on every render, including every drag frame.**
`CanvasInner` computed `nodes`/`edges` via `useMemo(() => toFlow(definition), [definition])`
and pushed EVERY intermediate change (React Flow fires one per pointer-move
during a drag) up through `onChange` to `JourneysManager`'s `definition`
state, then back down as a new controlled `nodes` prop. This is a known-fragile
pattern — forcing 30+ events/second through a separate component's state and
back is exactly what React Flow's own docs warn against for interactive
editing; the effect is nodes fighting their way back toward the last
committed position instead of following the pointer, and the same instability
made precise handle-to-handle connecting unreliable.

### Q2. The fix — **canvas owns its graph as local state (`useNodesState`/`useEdgesState`), the documented pattern for reliable drag/connect.**
Position and connection changes now stay entirely inside `JourneyCanvas`,
applied directly by React Flow's own change handlers — no round trip through
a sibling component mid-gesture. The graph is synced OUT to
`JourneysManager`'s `definition` (for save/validate/launch/match-count) via a
`useLayoutEffect` that fires after each settled change, not per pointer-move.
Switching journeys (new/load) now remounts the canvas via a `key` prop
(`selectedId` or a nonce for "new"), so local drag state never leaks between
journeys and never fights an external reset mid-edit.

### Q3. How do properties-panel edits (wait days, message body, branch condition, trigger entry) reach the canvas now? — **A ref-based `patchNode` method**, replacing the direct `definition` mutation.
`JourneysManager` calls `canvasRef.current.patchNode(id, data)`, which updates
the canvas's local node state directly — single source of truth for the
graph, syncing back out via the same layout effect. Verified no perceptible
lag: typing in the message textarea updates both the textarea and the
on-canvas node preview in the same tick.

**Verified:** build clean; live click-to-add (auto-wiring a message node from
the selected trigger) → the edge was NOT visible in the SVG (still the pane's
documented ResizeObserver limitation from Sprint 17 — RF can't compute edge
paths without measuring node dimensions, which the pane never triggers) —
but the validator correctly reported 0 problems, and saving + a direct DB
read confirmed the edge (`trigger → message`, auto-positioned 190px right)
persisted exactly right, proving the underlying state is correct even though
the pane can't render it. Panel-to-canvas sync verified live: editing the
message body reflected instantly in both the textarea and the node preview.
**Real drag/connect gestures still need the user's own browser** — the pane
cannot simulate raw pointer-drag sequences (documented Sprint 17 limitation);
the architectural fix follows React Flow's own recommended pattern exactly,
so it should resolve the reported symptom, but the user should re-verify.

## Sprint 17 — free-form journey canvas

User request (with Lucidchart screenshot): replace the stacked step editor
with a free-form drag-and-drop canvas. Mockup approved; React Flow chosen
over hand-rolling (their questionnaire answer).

### Q1. Library or hand-rolled? — **React Flow (`@xyflow/react`, MIT).**
The project's first UI dependency (~64kB, loaded only on /dashboard/journeys).
It provides the drag/pan/zoom/connect interaction layer that would otherwise
consume a sprint of edge cases. Custom node components keep the app's visual
language (trigger coral, wait gray, branch teal w/ Yes/No handles, message
violet with body preview).

### Q2. Tree or graph? — **The engine became a graph walker, and got simpler.**
definition = {nodes, edges}; a run's position is just "which node is next".
This unlocks what the tree couldn't express: **converging branches** (yes/no
paths rejoining) and **backward edges** (loop back for another nudge each
lap). Loops are safe by validation: every cycle must pass through a Wait ≥1
day. Legacy tree definitions are inert (none existed in prod).

### Q3. How do invalid drawings get caught? — **Two layers.**
While drawing: connection rules (one arrow out of ordinary nodes, one per
Yes/No side, no self-loops). Before launch: `validateGraph` gates the button —
exactly one wired trigger, at least one step (a trigger-only journey would
consume everyone's once-per-customer entry doing nothing — caught during
E2E), branches fully wired, no orphans, no empty messages, no wait-less
loops; problems listed in plain language.

### Q4. Click-to-add auto-wiring. — **Palette click chains from the selected node.**
Clicking a palette block adds it wired to the selected node's free outgoing
slot (branch fills Yes then No) and positions it beside; dragging drops it
free-form. Staff can build a whole chain without ever drawing a connection.

### Q5. Variables. — **{{days_away}} joins {{name}}/{{full_name}}, and {{code}} via attached offer.**
A message node can attach an existing campaign offer, which enables {{code}}
and ties journey redemptions into Sprint 14's exact attribution.

### Bugs found and fixed
(1) **Null-position constraint violation**: the graph engine returns
position null for completed runs; journey_runs.position is NOT NULL, so the
executor's upsert failed — **silently**, because upsert errors were ignored.
Launch enrolled nobody. Fixed: coalesce null→[] and log tick persistence
errors to the console. Lesson: fire-and-forget writes still need error logs.
(2) Trigger-only journeys were launchable (see Q3).

**Verified:** 29/29 graph-engine unit tests (validator: missing/unwired
trigger, branch missing No, double-out, empty message, orphan, 0-day loop
rejected vs 7-day loop allowed; walker: enrollment, waits, branch yes/no,
convergence, loop laps stay active, exit-on-order, closed window, stopped
inert, legacy inert, dedupe, unreachable, {{days_away}}/{{code}} rendering).
Live E2E: canvas renders a seeded 4-node branching journey with green
validator; real Launch → tick enrolled Sipho → branch took the still-away
path → inbox draft "Hi Sipho, it's been 42 days — we miss you!" ({{days_away}}
computed from his real last visit) → Skip persisted → cascade cleanup 0/0/0.
**Pane root cause identified while verifying:** the in-app browser pane never
fires requestAnimationFrame or ResizeObserver — which explains every pane
artifact this project has hit (frozen CSS transitions, unexecuted $RC
streaming, screenshot timeouts, and React Flow edges/fitView not drawing
in-pane). Canvas gestures (drag/connect) are React Flow core behaviour and
need a quick human sanity check in a real browser.

## Sprint 16 — journey designer (staff-authored automation)

Scoped with the user: journeys are **launched by a human** and then run for a
chosen window or evergreen; flows support **full yes/no branching**; the only
automated action in v1 is **preparing a message draft** (their questionnaire
answers).

### Q1. What does "automated" mean here? — **Human turns the key; the machine only prepares.**
A journey does nothing until a person launches it (choosing 7/14/30/90 days or
evergreen). While running, the tick enrolls qualifying customers and walks
them through the flow — but a message step only creates a draft in the
**action inbox**; sending is the human's click (which logs to
engagement_logs like campaign sends, with a live consent re-check first).
When the window closes: no new enrollments, in-flight customers finish.
Stop freezes everything; relaunch resumes.

### Q2. When does the tick run? — **On page load (dashboard inbox + journeys page).**
No always-on server needed. The tick is idempotent and race-safe: the unique
(journey_id, customer_id) constraint means two devices ticking at once can't
double-enroll (upsert ignoreDuplicates; the insert winner owns the actions).
Each customer enters a given journey once, ever. Wait due-dates anchor at
processing time, so a wait can drift later if nobody opens the app — accepted
for a counter business; a Vercel cron can call the same tick later if wanted.

### Q3. How is the branching flow stored and executed? — **A step tree + a cursor path.**
definition jsonb: entry rule + steps (wait / message / branch{yes[],no[]}) +
exit-on-order toggle. Runs carry a position path like [1,"yes",0]; branch
paths rejoin the parent flow when they finish. Branch conditions v1:
visited / not-visited since entering (more can join the vocabulary later).
Consent is enforced at draft time (unreachable → no draft, flow continues)
AND at send time.

### Q4. Bugs found while building/verifying — **two, both fixed.**
(1) The cursor used [] for both "start" and "past the end", so an active run
paused on a *trailing* wait would have restarted from step 0 — a trailing
wait now completes immediately (regression-tested). (2) The dashboard's
inbox fetch embeds customers via the new FK, and **PostgREST's schema cache
predated the migration** — the embed silently returned nothing until
`NOTIFY pgrst, 'reload schema'`. Lesson recorded: any migration adding FKs
used in embeds must notify PostgREST.

**Verified:** 29/29 engine unit tests (all 5 entry types, enrollment dedupe,
wait pause/resume, branch yes/no + join incl. empty paths, exit-on-order,
closed window = no new entries while in-flight finish, draft/stopped inert,
unreachable-customer flow, trailing-wait regression). Live E2E: designed
"E2E test journey" (entry: at-risk, one WhatsApp draft step), launched
evergreen → tick enrolled Sipho and prepared a fully personalised draft
(name + unsubscribe token) → inbox badge 1 → Skip persisted
(status=skipped, acted_at stamped) → journey deleted, cascade left 0/0/0.
Security: anon SELECT = 0 rows and INSERT rejected on all three new tables.
Glossary entries "Journey" and "Action inbox" ship in the same sprint.

## Sprint 15 — suggested actions (journey automation)

Priority 3: the journey ribbon was passive — you had to notice "18 at risk"
and think to act. The dashboard now suggests the action.

### Q1. How much autonomy? — **Suggest + prepare only; the human drives everything after.**
Per the AGENTIC_LAYER's medium-risk rule, a suggestion never sends or creates
messages. Clicking "Start campaign" does exactly two things: ensures a saved
segment for the audience exists (creating or refreshing an "(auto)" segment),
then opens the composer with it preselected — where the existing compose →
review → approve flow takes over. The panel says so in plain text.

### Q2. Which suggestions? — **Three, each conditional on real data.**
Win-back (customers in the at-risk stage), birthdays this month, and
newcomers (signed up ≤30 days, no orders yet). A card only renders when its
count > 0, and its button disables when nobody in the group is reachable —
no dead suggestions. Definitions live in `lib/suggestions.ts` and reuse the
exported stage thresholds.

### Q3. What guarantees the click shows the same people the card counted? — **A tested invariant.**
Each suggestion's segment definition is expressed in ordinary segment criteria
that mirror the stage semantics. Unit-tested: for every suggestion,
`filterProfiles(definition)` returns exactly `count` on synthetic data
covering churned/active/old-signup exclusions. Auto segments are refreshed on
each use (the birthday month rolls over) and are ordinary segments — visible,
editable, deletable in the segment manager.

**Verified:** 8/8 unit tests (branch counts + the definition-matches-count
invariant); live UI: dashboard showed exactly one card ("Win back at-risk
customers — 1 customer… 1 of 1 reachable", no unsupported cards), click
created "At risk — win-back (auto)" and landed on the composer with it
preselected showing WhatsApp · 1 recipient — panel count and composer count
agree. Test auto-segment deleted after verification. No new tables/policies;
segment writes ride existing staff-only RLS.

## Sprint 14 — offers + redemption (exact attribution)

Priority 2 from the journey review: "came back" is correlation; an offer code
redeemed at the counter is proof.

### Q1. Standalone offers table, or offer-on-campaign? — **On the campaign.**
The point of P2 is exact campaign attribution, so the offer lives on
`campaigns` (code + percent/amount + value, one live code per campaign,
case-insensitive unique). Standalone/walk-in promos would need their own
manager UI and dilute attribution — deferred until wanted.

### Q2. What does a redemption change on the order? — **total = charged, discount recorded, campaign stamped.**
`orders.total_cents` KEEPS meaning "final charged amount" (so revenue,
loyalty-by-spend and attribution all stay truthful with zero changes);
`discount_cents` records what came off; `campaign_id` is the exact link.
Percent discounts track the cart live until placement; after placement the
discount amount is a fixed snapshot — editing lines later recomputes
charged = lines − discount (floored at 0), consistent with the price-snapshot
rule. Loyalty note: points accrue on the discounted (charged) amount.

### Q3. Is the code locked to campaign recipients? — **No.**
Counter reality: codes get shown around, customers bring friends, staff may
not link a customer. A shared code is marketing reach, not a fraud surface at
a café till — staff judgment applies. Walk-in redemptions still stamp the
campaign, so they count as exact redemptions even with no customer record.
No expiry in v1 (logged as future work).

### Q4. How do redemptions read in results? — **A separate, windowless metric.**
"Redeemed" = completed orders stamped with the campaign, no time window,
walk-ins included — deliberately distinct from "came back" (windowed,
recipients only). Results card shows both; a returning recipient whose order
carries the stamp gets a violet "Redeemed" badge instead of "Came back".
`{{code}}` joins the message template placeholders, and enabling an offer
auto-appends "Show code {{code}} at the counter." if the body lacks it.
Glossary entries for "Offer code" and "Redeemed" ship in the same sprint,
per the Sprint 13 convention.

### Q5. Found during E2E: redemption with zero sends was invisible. — **Fixed.**
The Results card and list cell were gated on sentCount > 0, so a code redeemed
before any send was marked (a legitimate counter scenario) didn't show. Both
now also render when redemptions exist, with the percentage suppressed to
avoid divide-by-zero.

**Verified:** 15/15 unit tests (percent/amount/cap/rounding discount math,
{{code}} rendering, redemption exactness: cancelled and other-campaign orders
excluded, walk-in outside the window included, per-customer redeemed flags).
Full E2E through the real UI on live data: composed "TEST sprint14 offer"
(10%, TESTRM99) → 4-recipient run created with offer chip → order pad applied
lowercase "testrm99" to a R170 cart (−R17.00, total R153.00) → placed walk-in
order #19 → advanced open→preparing→ready→completed → campaign showed
Redeemed 1 (R153.00) and the list "0 · 1 redeemed". DB row confirmed
(15300/1700/campaign stamped), then all test rows deleted (order #19,
campaign + its 4 log rows) — production data restored exactly.
Security: no new policies needed — offers ride existing staff-only RLS on
campaigns/orders; the code lookup is parameterised supabase-js.

## Sprint 13 — metrics glossary

User request: "came back" (and the app's other jargon) needs its definition
discoverable everywhere, plus a knowledge base.

### Q1. Where do definitions live? — **One source of truth in `lib/glossary.ts`.**
Every term is defined once, and the numeric thresholds are **imported from the
same constants the engines compute with** (`ATTRIBUTION_WINDOW_DAYS`,
`AT_RISK_DAYS`, `CHURN_DAYS`, `LOYAL_MIN_ORDERS` — the latter three newly
exported from `lib/segments.ts` and now used by `stageOf` and the dashboard
at-risk flag instead of magic numbers). Change a threshold in code and every
tooltip and glossary entry updates itself; definitions cannot drift from
behaviour.

### Q2. How are definitions surfaced in place? — **Three tiers by context.**
(1) `InfoTip` — a tap-to-open ⓘ popover (term, one-liner, exact computation,
link to the full glossary). Tap, not hover, because of the counter iPad; closes
on outside-tap/Esc. Placed on stat labels that sit outside scroll containers:
campaign Results card (sent / came back / revenue after send), segments page
(journey stages, matches, reachable), dashboard stat cards (active orders,
revenue). (2) Native `title` + dotted underline on labels **inside**
`overflow-x-auto` tables, where a popover would clip: campaigns-list "Came
back"/"Revenue after" headers, dashboard "Loyalty" header, the At Risk badge.
(3) `/dashboard/glossary` — the knowledge base, 14 entries in 4 groups, each
with the plain-language meaning, the exact computation, and where it appears.
Linked from every tooltip and from the sidebar footer (book icon, active-state
aware).

### Q3. Tone of the definitions? — **Plain language, honest caveats.**
"Came back" explicitly says it shows correlation ("after the message, not
necessarily because of it"); "at risk" says it's a prompt, not a verdict.

**Verified** (staff login, local prod build): dashboard shows 2 stat tips +
titled Loyalty header; Revenue tip opens with the correct definition and its
glossary link navigates (and closes the tip); glossary renders 14 entries/4
groups with the live 14-day constant interpolated; sidebar marks Glossary
active; segments page shows all 3 tips. No new data surface — the page is
static content from code.

## Sprint 12 — campaign measurement loop

Chosen with the user from the journey-map review: everything up to "send" was
done or optimised, nothing after it existed. This sprint closes the loop.

### Q1. How is "did the campaign work" measured? — **Post-send completed orders within a window, labelled honestly.**
A recipient "came back" if they placed a **completed** order strictly after
their `sent_at` and within **14 days** of it (inclusive at the boundary).
Revenue after send = sum of those orders. The UI label says "completed orders
within 14 days of each send" — this is post-send revenue, deliberately not
claimed as causal. Consistent with loyalty, cancelled/in-progress orders and
walk-ins never count. 14 days fits café visit frequency; it's one constant
(`ATTRIBUTION_WINDOW_DAYS`) if the user ever wants it changed.

### Q2. New tables, or compute on read? — **Pure read-side; zero migrations.**
`lib/attribution.ts` is a pure function over data already fetched
(`engagement_logs.sent_at/customer_id` + completed orders). No materialised
stats to drift, and results update live as sends happen. The unused-since-0001
`engagement_logs.outcome` column finally gets its UI: opened / replied /
ignored buttons on each sent row (tap again to clear), per the original data
model's enum.

### Q3. Where do results show? — **Three altitudes.**
Campaigns list gains "Came back" (n, %) and "Revenue after" columns; the
campaign detail gains a Results card (sent / came back / revenue) and
per-recipient "Came back · R…" badges vs "No return yet". Derived (automatic)
return data and staff-observed outcomes are kept visually distinct.

**Verified:** 9/9 unit tests on the transpiled engine — unsent and
customer-less rows excluded, cancelled orders excluded, pre-send orders
excluded, multi-order summing, window end inclusive, 1ms past excluded, order
at the send instant excluded. Live UI (staff login, local prod build):
list columns show the real campaign truthfully (1/4 sent, 0 returned, — )
and the detail card reads Sent 1 / Came back 0 (0%) / R0.00; outcome button
round-trip confirmed against the DB (`replied` persisted, then cleared to
null, restoring the user's data exactly). No new security surface — writes go
through the staff-only `engagement_logs` RLS verified in the Pass B checks
(anon insert rejected, anon update affects 0 rows).

## Sprint 11 — navigation shell + UI polish

### Q1. Where does the nav live? — **One shared `app/dashboard/layout.tsx` wrapping every dashboard route in `DashboardShell`.**
Six screens each carried their own ad-hoc `<nav>` link row, all slightly
different (some missing links, sign-out only on the dashboard). A segment-level
layout gives every page the same sidebar automatically and the per-page navs
were deleted — seven components no longer own navigation. Detail pages keep a
single contextual "← back" link.

### Q2. What does the hamburger do? — **Two behaviours by breakpoint.**
Desktop (md+): a persistent left sidebar; the hamburger collapses it to a
64px icon rail (labels hidden, `title` tooltips remain) and the preference
persists in localStorage. Mobile/iPad-portrait: a 56px top bar with the
hamburger opening an overlay drawer + backdrop; the drawer closes on backdrop
tap and automatically on route change. Active route is highlighted (exact match
for /dashboard, prefix match for sections so detail pages light their section).

### Q3. Icon library or hand-rolled? — **Nine inline SVG paths, no dependency.**
The app has zero icon dependencies; adding one for nine glyphs isn't worth the
bundle or the supply-chain surface. Stroke-style paths inherit `currentColor`.

### Q4. How much visual polish? — **A coherent pass, not a redesign.**
Neutral-50 canvas with white cards; all data tables card-wrapped
(rounded-xl border, neutral-50 header row, row hover); consistent
`text-2xl font-bold tracking-tight` page titles; dashboard gained a 4-stat
metrics row (sign-ups, active orders, completed, revenue — computed from data
already loaded). Sign-out moved into the sidebar footer. The touch-first order
pad flow was left intact.

**Verified** (staff login, local prod build, in-pane browser): sidebar renders on
every dashboard page with correct active state; collapse toggles labels + rail
width and survives a full reload (localStorage); mobile drawer opens with
backdrop, closes on route change; navigation via the drawer lands on the right
page with content inside the shell. Two pane artifacts were investigated and
ruled out as app bugs: (1) rail width appearing stuck at 240px — a CSS
transition frozen because the pane doesn't advance animation frames (class list
was correct; class re-add snapped to 64px); (2) streamed full-document loads
showing an empty `<main>` — the pane never executes React's inline `$RC`
streaming-completion scripts. Discriminator: `/dashboard`, whose streaming
boundary predates this change and works in production daily, fails identically
in the pane, while every client-side navigation renders fully; the raw HTML
contains the complete content plus the `$RC("B:0","S:0")` call.

## Sprint 10 — custom criteria + segment merge/exclude

User request, with explicit latitude to extend further ("free realm... cover all
grounds"). Two asks: (1) let staff define new segmentation criteria beyond the
built-in eight, (2) let a segment merge with or exclude another saved segment.
Both were designed to reuse the existing engine rather than add a parallel one.

### Q1. What does "create new criteria" mean for non-technical café staff? — **Staff-defined custom fields (name + type), not a query language.**
A `custom_fields` table (key, label, value_type: text/number/boolean/date) lets
staff type a name like "Spice level" or "Table preference" and pick a type; each
row compiles to a `FieldDef` via `customFieldToDef()` — same shape as the eight
built-ins (operators, default value, `evaluate()`), so it drops into the builder
palette and the AND/OR engine with zero special-casing elsewhere. Values live in
a new `customers.custom_fields jsonb` column, set through a per-customer editor
added to the dashboard sign-ups table (the same pattern Sprint 9's tag editor
used) — so a criterion is settable the moment it's created, not a dead field.

### Q2. How do "merge" and "exclude" fit the existing AND/OR tree? — **A third node type, `segment_ref`, alongside condition and group.**
No schema change: `segments.definition` already stores an arbitrary jsonb tree,
so `{type:"segment_ref", segmentId, mode:"include"|"exclude"}` is just a new leaf
shape. Merge = two `include` refs inside an `any` (OR) group — union. Exclude =
an `include` ref AND an `exclude` ref of another segment — subtraction. Dragging
a "Saved segment" palette chip into the canvas adds one; a toggle sets
include/exclude, a select picks which saved segment. A segment can't reference
itself (excluded from its own dropdown); referencing a *deleted* segment
resolves to no-match rather than crashing.

### Q3. What stops A→B→A from hanging the browser? — **A `visiting` set threaded through recursion, not a depth limit.**
`matchesNode` carries the chain of segment ids currently being resolved; hitting
an id already in that chain returns `false` for that branch instead of
recursing again. Exact, not a heuristic cutoff — a legitimately deep (non-cyclic)
reference chain still resolves fully. **Verified:** a manufactured A↔B cycle
resolves to `false` without throwing or hanging.

### Q4. What else was in scope for "cover all grounds"? — **Duplicate segment; nothing beyond that.**
Cloning a saved segment (new id, "(copy)" name, same definition) makes the
merge/exclude workflow fast — duplicate a segment, then add an exclude ref —
without inventing a separate "combine two segments" UI mode. Declined: version
history, an audit trail, and a dedicated merge/exclude wizard — the generic
canvas already covers those cases via `segment_ref`, and a parallel UI would be
duplicate surface area for the same capability.

**Security (binding DevSecOps — new surface: `custom_fields` table,
`customers.custom_fields`):**
1. **Isolation — PASS.** anon SELECT `custom_fields` = 0 rows; anon INSERT
   rejected (42501); anon UPDATE of `customers.custom_fields` on an existing row
   affects 0 rows (existing customers RLS already covers the new column).
2. **SQL injection — PASS.** All custom-field reads/writes go through
   parameterised supabase-js; `value_type` is CHECK-constrained (an invalid type
   is rejected) and `key` is UNIQUE (a duplicate insert is rejected).
3. **Correctness — PASS (28/28 unit tests).** All four custom field types
   (text/number/boolean/date) across their operators, missing-value handling,
   segment_ref include/exclude, merge (union), subtract (exclude), dangling
   reference, and the cycle guard.

## Sprint 9 — campaigns (Pass B)

### Q1. How do campaigns send with no provider keys wired? — **Manual deep-link mode: the staff click IS the send.**
The user chose "build composer, wire provider later". Rather than a fake "sent"
button, each recipient row generates a personalised `wa.me` (or `mailto:`) link;
clicking it opens WhatsApp/the mail app with the exact message pre-filled and the
staff member presses send there. Real, usable today for a WhatsApp-first café,
zero keys, and *nothing ever dispatches autonomously* — stronger than the
AGENTIC_LAYER's approval gate requires. SMS/Telegram/LINE sit in the channel
registry as visible-but-disabled entries; wiring an API provider later is a new
registry entry + a server send path, no UI rework.

### Q2. New message-log table, or the planned one? — **Reuse `engagement_logs`.**
`docs/DATA_MODEL.md` designed it for exactly this (channel, message_draft,
review_status, sent_at, sent_by, outcome). Migration 0005 adds `campaign_id`
(FK, cascade) plus a `campaigns` table that snapshots segment name/definition and
the composed body — send history never rewrites when a segment is later edited,
consistent with the order-line price-snapshot pattern. Rows are written with
`message_draft_source='template'`, `review_status='approved'` (human-composed).

### Q3. Where is consent enforced? — **Twice: at recipient resolution AND at send time.**
The channel registry's `address()` returns null without opt-in + contact info, so
the composer can never list a non-consenting recipient (excluded count shown).
The send-run screen re-derives the address from the *live* customer row, so
someone who unsubscribes after the run was created renders as "Skipped —
unsubscribed", link disabled. Every message body carries the unsubscribe link
(appended in `composeMessage`, stored verbatim in the log). **Verified in unit
tests:** no-consent and no-phone profiles → null address on both channels.

### Q4. What does the approval step actually create? — **The campaign row + one approved log row per recipient, atomically-ish.**
Compose → review (full recipient list + exact message) → "Approve & create send
run" inserts the campaign then bulk-inserts the log rows; if the log insert
fails the campaign row is deleted so no empty run is left behind. Each send
click stamps `sent_at`/`sent_by` on its row and `customers.last_contacted_at`
(the column 0001 always intended for this); the last stamp sets
`campaigns.completed_at`.

### Q5. Personalisation scope? — **`{{name}}` / `{{full_name}}` only.**
A café promo needs the first name, not a template language. More merge fields
are one line each in `renderTemplate` when wanted.

**Security (binding DevSecOps — new surface: `campaigns` table, `engagement_logs.campaign_id`):**
1. **Isolation — PASS.** anon SELECT campaigns = 0 rows; anon INSERT campaigns and
   engagement_logs both rejected (42501); anon UPDATE engagement_logs affects 0 rows.
2. **SQL injection — PASS.** All writes go through parameterised supabase-js; the
   channel column is constrained by a CHECK (an invalid channel insert is rejected).
3. **Exfiltration — PASS.** No new secrets exist at all (manual mode needs no keys);
   nothing beyond the anon JWT ships to the client.
4. **Send-path safety — PASS (17/17 unit tests).** Template render, unsubscribe
   footer always appended, consent gating (opt-out or missing contact → null),
   wa.me digit normalisation + URL encoding, mailto subject/newline encoding,
   unwired channels produce no link. Schema flow verified: create run → 2 log
   rows, cascade delete leaves 0 orphans.

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
