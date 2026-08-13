# Backlog

Parked work — not scheduled, revisit when wanted. Each item is self-contained
so it can be picked up without re-reading the whole thread. Newest first.
See `DECISIONS.md` for the reasoning behind the deferrals.

## Dashboard pagination — TRIGGERED BY TENANT SIZE (parked 2026-08-13)

**Do not build this on a schedule. Build it when a single shop crosses the
threshold below.** Parked deliberately after Sprint 50, not left undone.

### The trigger

Watch the **largest single business's customer count**, not the total row count
of the database. Every query here is business-scoped, so a database holding a
million customers across a thousand shops averaging a thousand each has no
problem at all — each page load still touches about a thousand rows. This
architecture scales on tenants for free. It scales on shop size badly.

| Largest shop | Action |
|---|---|
| under ~2,000 | Nothing. The current design is strictly better — see below. |
| ~2,000–10,000 | **Build the pagination.** Scope is in this entry. |
| ~10,000+ | Pagination is no longer sufficient — the loyalty score has to be materialised, which collides with DECISIONS Sprint 29 Q1. Own argument, own sprint. |
| ~100,000+ | Different architecture: search index, precomputed segments. Rewrite territory. |

**How to see the number.** While there is one shop, the dashboard's Sign-ups
stat card already is it — 304 today, trigger at 2,000, and it is on a page read
constantly. No build needed. Once there are several shops the question becomes
"which is largest", which no tenant-scoped page can answer, so
`scripts/tenant-sizes.sql` reports customers and orders per shop with the band
each one falls in. Run it by hand.

Deliberately not built: an in-app operator view. It would need a cross-tenant
super-admin role that does not exist, and inventing one to display a number is
the wrong trade — every other query in this codebase is business-scoped on
purpose.

### What is parked

`app/dashboard/page.tsx` and `app/dashboard/orders/page.tsx` still send every
customer and every order to the browser. Sprint 50 routed them through `readAll`,
so they are complete-or-loud rather than silently truncated — but they are not
small. Their client-side sort, search and 25-row pager all operate on the full
set in memory, which is why paging them means rebuilding all three.

### Why not now (304 customers)

The current version is genuinely better at this size: search and sort are
instant because everything is already in memory, and there are no round trips.
Pagination would trade that responsiveness for a payload problem the shop does
not have. The 340 ms per interaction is constant rather than growing, but it is
charged on *every* keystroke, sort and page change — a real daily cost for staff
doing lookups.

Mockup comparing the two, built 2026-08-13 before deciding:
https://claude.ai/code/artifact/c158f6ef-ea80-4b12-b1de-5934abd6bcd6

### How it fails if the trigger is missed

Loudly, in steps — Sprint 49 made sure of that. Payload reaches tens of MB
around 5–10k customers and page loads run to seconds; `buildProfiles` blocks the
main thread around 50k; past roughly 100k the sequential paged reads risk the
serverless timeout; and at 200,000 `readAll` refuses outright with "too many to
load in one go". Nothing goes quietly wrong, which is why parking it is safe.

### Scope when it fires

1. **A migration.** Loyalty is derived from completed order count and spend, so
   it is not a column you can `ORDER BY`. Returning 25 rows already in loyalty
   order needs a SQL function — this is the part that makes it more than a
   `.range()`.
2. **Search moves server-side**, debounced against name and phone, or the box
   silently searches only the page you are on.
3. **The orders select embeds `customers(first_name, last_name)`.** Order rows
   resolve names from the in-memory customer array today and would otherwise all
   read "Unknown".
4. **Out-of-range page clamping moves to the server.** `usePager` clamps today
   because the row count can shrink underneath it; a bad `?page` would otherwise
   yield an empty range with no way back.
5. Stat cards become one SQL row. Revenue is a `SUM`, so `head: true` counts
   cannot serve it.

At the 10,000+ tier, add: materialising the loyalty score, and with it the
maintenance burden on every order write, refund, merge and import undo — which
is exactly what "points are derived, never stored" was protecting against.

## Multi-tier: free vs paid split (parked 2026-07-29)
The app is entirely free today — every feature is available to every tenant and
nothing can earn. `lib/stripe/index.ts` + the three `/api/stripe/*` routes exist
but are **unused Vibe Launchpad scaffold**: zero references anywhere in
`components/` or `lib/` outside `lib/stripe`, and zero plan/tier/subscription
columns across all 21 migrations. Nothing is half-built, so this starts clean.

Shape when picked up:
1. **Decide the split** (the only real decision, and it's the founder's).
   Suggested basis: gate what costs money or replaces a vendor — AI analyst +
   copilot, direct provider sending (Resend/Twilio/WhatsApp Cloud API),
   journeys. Keep POS + customers + manual deep-link sends free, so the core
   job always works. Ties price to actual marginal cost.
2. **Schema** — `businesses.plan` ('free'|'pro'), `stripe_customer_id`,
   `subscription_status`. One migration.
3. **One gate helper** — `lib/plan.ts` → `canUse(business, feature)`, mirroring
   the existing `lib/permissions.ts` pattern (fixed catalog in code; a tier is
   only real if code enforces it). Server-side enforcement, single choke point.
4. **Wire the existing routes** — real price id in checkout, webhook flips
   `businesses.plan`, portal for self-serve management.
5. **UI** — Billing section in Settings + soft upsell at each gated feature.

Steps 2–4 are ~a day; step 1 is the blocker.

## Copilot follow-ups (from Sprint 34)
- **Full acceptance rate (generated vs used)** — the Reports "AI copilot" card is
  computed from engagement_logs (sent-as-is vs edited + attributed revenue). The
  drafts-generated denominator lives in `audit_log` (`copilot.draft` rows), which
  is team-permission-gated. A team/owner eval screen could read audit_log for a
  true "drafted N, sent M" rate + per-draft thumbs.
- **Draft variants** — copilot returns one draft today; offering 2–3 variants to
  pick from would raise acceptance. `runAnalyst` already returns one message;
  needs a variants prompt + a chooser in the composer.
- **Copilot in journeys** — same drafter for the journey message step (the other
  place humans hand-write copy), not just one-time campaigns.
- **Red-team gate before autonomy (Sprint 35)** — blocking, 6 items (prompt
  injection suite, send-path integrity, tenant isolation, secrets containment,
  consent bypass, abuse/rate limits). Items 1/3/5 become permanent regression
  suites. Copilot is draft-only so it sits below the gate, but the gate must pass
  before any agent action executes without a human.

## Analyst follow-ups (from Sprint 33)
- **Bring-your-own-key (Version B of model choice)** — let a tenant supply their
  OWN provider key (Anthropic/Gemini/OpenAI), billed to them. Deferred from
  Sprint 33b behind a gate: (1) encrypted secret storage (Supabase Vault /
  pgsodium — never plaintext), following the `channel_providers` service-role-only
  pattern; (2) a validated multi-provider adapter (the `lib/analystRunner.ts`
  seam is ready); (3) the injection red-team re-run per allowed provider. Even
  then, keep action-taking agents (Sprint 34+) on vetted models only — BYOK is
  fine for the read-only analyst, not below the security floor for writes.
- **Streaming answers** — the chat waits for the full reply; streaming needs a
  route handler (server actions can't stream) + incremental rendering.
- **Per-tenant token budget / rate limit** — one shared platform key today;
  before opening the analyst to many tenants, add a per-business daily cap
  (audit_log already records token usage per exchange, so the meter exists).
- **Findings glossary/tooltips** — add `notable_findings` to the glossary and
  InfoTips on the cards explaining windows and thresholds.
- **Injection regression suite** — seed a QA tenant with adversarial customer
  names ("Ignore previous instructions…") and assert the analyst never obeys;
  becomes part of the red-team gate before Sprint 35.
- **Eval review screen** — audit_log rows (`analyst.qa`) are written; a small
  owner-facing view of recent Q&A with thumbs-up/down would close the loop.

## Deferred integrations

### Telegram campaign sending — capture customer chat ids
Telegram is connectable in Settings and the composer honestly shows it as
"connected · setup needed", but it can't send a campaign: a Telegram bot may
only message a customer who has messaged the bot first, and we don't capture
those chat/user ids. Needs: a way for a customer to link their Telegram (e.g. a
deep link / start code on the sign-up or receipt flow), a column to store the
chat id, and wiring Telegram into the campaign run send path. Until then it
stays `connected_setup` in `channelStatuses()` and is not selectable.

### SMS (Twilio) campaign sending
Twilio can be configured as a provider in Settings but isn't wired into campaign
runs — there's no manual deep-link mode for SMS, so it needs a real server send
path. Add SMS to the campaign run dispatch alongside the email/Resend path,
gated on the provider being connected.

## Multi-tenant follow-ups (from Sprint 32)
- **Per-tenant order numbers** — `orders.order_no` is a global identity, so
  shop B's first order might be #47. Cosmetic; needs a per-business sequence
  with race-safe increment.
- **QR image generation** — Settings shows the /s/<slug> link with copy/open;
  generating a printable QR PNG needs a small client-side generator.
- **Subdomain URLs** (kofi.rice-mice.app) — path URLs shipped first; subdomains
  need wildcard DNS + Vercel config.
- **Multi-shop membership** — drop `memberships` unique(user_id), add a shop
  switcher, pass business_id explicitly on inserts (today's column DEFAULT
  relies on single membership).
- **Landing page** — `/` is a minimal placeholder; real marketing page later.

## Full loyalty rule builder (scope C — future discussion)
Sprint 30 shipped scope B (editable weights + welcome bonus). Scope C — owner-
defined additive earning rules (per-tag, per-item, referral, birthday,
streak…) — was deliberately deferred: those mechanics overlap almost entirely
with the gamification idea below and should be designed together with it, not
as a second engine. Revisit when gamification is shaped.

## Customer CSV import — **SHIPPED, Sprints 45–46** (verified in production 2026-08-10)
Done and verified end to end: 299 customers, then 281 orders from a 594-row
line-item export, with an import → undo → re-import round trip that returned
revenue to the cent. See `TASKS.md` Sprints 45 and 46 for the delivered scope
and the design calls worth remembering.

The open decision below was settled — **import an order-history CSV**, not
seeded baseline columns, because real orders make every derived field correct
through the existing `buildProfiles()` with no changes and leave the "points are
derived, never stored" invariant untouched. That held up: spend, average,
favourite item and last visit all came out right with zero segmentation changes,
and cancelled receipts are kept as history while being excluded from all four.

Two gaps this work exposed, both still open:
- **No import creates customers from an order file.** An order whose customer
  isn't already on file is reported and either skipped or landed as a walk-in
  sale. Fine for the customers-then-orders flow; a shop that only has a POS
  export has no path in yet.
- **Vendor exports rarely carry a signup date.** Klaviyo's doesn't, so every
  imported customer reads "member since" the import day and the `signed_up`
  criterion is unusable on that data. `created_at` is only written when the file
  actually has a date — deliberately, since an "earlier of the two" rule was
  designed and then refuted (it fires on agreement, and `min()` is absorbing, so
  a corrected re-import could never move a date back).

Original notes kept for context:

Lets a real café load its existing customer list — an adoption blocker more
than a feature. Key design fact (asked 2026-07-13): segmentation profiles are
built from TWO sources — customer attributes (name, phone, email, opt-ins,
tags, birthday, custom fields) and order-derived behaviour (spend, order
count, last visit, favourite item). A CSV import populates the first group
fully — attribute criteria and custom-field criteria work immediately,
especially if unknown CSV columns are offered as new custom fields at import
time. The second group stays empty until orders accumulate in-app: everyone
imports as journey stage "new" with 0 points. Closing that gap needs a
decision — import an order-history CSV too, or seed baseline columns
(total spend / order count / last purchase) and teach `buildProfiles` to use
them as a floor. Consent flags must be imported conservatively (no opt-in
column → opted out).

## Duplicate / merge customers
Same person signing up twice (two phone spellings, WhatsApp vs email) is
inevitable. A merge tool = pick survivor, repoint orders/engagement_logs/
signup_events, union tags/custom fields, delete the duplicate. Every CRM
needs it eventually; cheap to defer until real data shows duplicates.

**Sprint 46 gave it a second, sharper motivation.** The order importer hits
receipts whose email resolves to one customer and whose phone resolves to
another — 6 in a 330-receipt test export, and the causes are ordinary (shared
handsets, counter typos, recycled numbers). It refuses to guess, because
attaching the sale either way also moves the wrong customer's last visit and can
flip their lifecycle stage. So those orders are reported and dropped, and the
only fix available today is editing the source CSV or the customer record by
hand. A merge tool is what actually resolves them — which makes this a blocker
for importing a messy real-world export cleanly, not just eventual hygiene.

## Manual points adjustment (goodwill / comp)
Challenges the "points are derived, never stored" invariant (Sprint 29 Q1).
The clean design is an append-only `point_adjustments` table (customer, delta,
reason, staff, timestamp) that the derivation SUMS — still no mutable balance,
cancelling/refunding stays automatic, and the 360 page's breakdown gets an
"adjustments" line. Needs a permission decision (who may comp points).

## Gamification (idea — to shape later)
Turn the loyalty program into something customers feel, building on the derived
points engine (`lib/loyalty.ts`). Candidate mechanics, roughly by value for a
WhatsApp-first café:
- **Tiers / levels** (Bronze/Silver/Gold by points or lifetime spend, each with
  a perk) — cheap to derive, shows on the Customer 360 page and receipts.
- **Punch-card challenges** ("buy 5 coffees, get one free"; "try 3 new items
  this month") — the classic café mechanic; maps onto the rewards engine but
  goal/time-boxed. Highest-value candidate.
- **Progress-to-next-reward nudges** ("80 pts from a free pastry") — small,
  drives repeat visits, feeds the campaign composer.
- **Streaks** ("visited 4 weeks running") — derivable from order dates.
- **Badges / achievements** ("Tried 10 items", "Weekend regular") — fun, lower
  ROI; derive from `itemsPurchased` / order timing.
- **Referral rewards** — `signup_events.referral_code` already exists; award
  points for a referral that converts. Ties gamification to growth.
Constraint to respect: points stay **derived, never stored** (DECISIONS Sprint
29 Q1), so any mechanic must be computable from order/customer history, not a
mutable counter. Streaks/tiers/challenges all satisfy this.

## Housekeeping (found in the decision log)
- **Drop the dead `customers.loyalty_score` column** — unused since Sprint 7
  (loyalty is derived client-side). Harmless but dead weight; drop in a future
  migration or fold into the loyalty-config migration.
- **Tighten Supabase Auth rate limits** — Sprint 7 security check found password
  logins weren't throttled within an 8-attempt burst. Service config
  (Dashboard → Authentication → Rate Limits), not app code.
- **Standalone / walk-in promo codes** — offers currently live only on a
  campaign (for exact attribution). A standalone promo-code manager was deferred
  in Sprint 14 "until wanted".

## Shipped from this backlog
- **Customisable loyalty scoring criteria** — Sprint 30 (scope B).
- **Customer 360 page** — Sprint 31.
