# Backlog

Parked work — not scheduled, revisit when wanted. Each item is self-contained
so it can be picked up without re-reading the whole thread. Newest first.
See `DECISIONS.md` for the reasoning behind the deferrals.

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

## In planning (this pass)
- **Customisable loyalty scoring criteria** — see current-thread plan.
- **Customer 360 page** — per-customer detail view; see current-thread plan.
