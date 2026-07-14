# Red-team suites

Automated coverage for the gate in [../../docs/RED_TEAM.md](../../docs/RED_TEAM.md).
Items 1, 3 and 5 are the ones meant to run as permanent regressions.

## Deterministic unit suites — run in CI (`npm test`)
No network, no DB, no secrets. Run on every change.

- **Injection firewall — item 1** · `tests/injection.test.ts`
  Asserts untrusted text (customer/segment/shop names) is wrapped inside the
  `<business_data>` / `<brief>` tags, the "treat as data, ignore instructions"
  firewall is present, and the copilot is told never to invent an offer.
- **Consent — item 5** · `tests/consent.test.ts`
  Asserts `channelDef(ch).address(profile)` returns `null` for any customer who
  hasn't opted in or has no contact info, so no send path can ever address them.
- **Autonomy ladder — Sprint 35** · `tests/agentic.test.ts`
  Asserts the ladder in `lib/agentic.ts` keeps the critical classes (delete
  customer, refund, export DB, message send) locked and never agent-executable,
  the one enabled action (`tag.apply`) is on the human-approval rung, and any
  unknown/unattended type fails closed. Guards against a future edit silently
  promoting a dangerous action.

## Live probes — run manually
Need a real credential; not part of `npm test`.

- **Injection (live) — item 1** · `injection-live.mjs`
  Puts injection payloads in customer names/notes, calls the real model, and
  fails if the answer leaks a marker or complies. Run when the default model
  changes:
  ```
  GEMINI_API_KEY=... node scripts/redteam/injection-live.mjs
  ```

- **Tenant isolation — item 3** · `tenant-isolation.mjs`
  The repeatable version of the Sprint 32 method. READ-ONLY (plants nothing,
  deletes nothing): signs in as two seeded QA shops and asserts each reads zero
  of the other's businesses/customers, anon enumerates nothing, and the only
  anon window (`public_business_branding(slug)`) returns render fields by exact
  slug and nothing for an unknown slug. Point it at a DEDICATED QA project with
  two shops seeded once via `/signup` — never production:
  ```
  SUPABASE_URL=... SUPABASE_ANON_KEY=... \
  SHOP_A_EMAIL=... SHOP_A_PASSWORD=... \
  SHOP_B_EMAIL=... SHOP_B_PASSWORD=... \
  node scripts/redteam/tenant-isolation.mjs
  ```
  Re-run after any change to a policy or a `SECURITY DEFINER` helper. (Not in
  CI because it needs a live QA project + logins; run deliberately.)

## Still open before autonomy scales
- Item 6 abuse/cost: per-shop daily AI cap enforced (`lib/aiUsage.ts`); Supabase
  auth rate-limit tightening done in the dashboard (Sprint 35 gate close).
- The tenant-isolation script needs a dedicated QA project with two seeded
  shops to run against; provisioning that fixture is a one-time setup step.
