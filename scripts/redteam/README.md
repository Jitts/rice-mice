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

## Live probes — run manually
Need a real credential; not part of `npm test`.

- **Injection (live) — item 1** · `injection-live.mjs`
  Puts injection payloads in customer names/notes, calls the real model, and
  fails if the answer leaks a marker or complies. Run when the default model
  changes:
  ```
  GEMINI_API_KEY=... node scripts/redteam/injection-live.mjs
  ```

- **Tenant isolation — item 3** · manual (Sprint 32 method)
  RLS is the fence; verified in Sprint 32 by planting a throwaway shop B
  (`d0000000-…-beef`) and asserting a shop-A staff session sees zero of B's
  customers/roles/branding and anon enumerates nothing, then cascade-cleaning
  it. Re-run against production after any change to a policy or a
  `SECURITY DEFINER` helper. (Involves prod writes, so it's run deliberately,
  not in CI.)

## Still open before Sprint 35 (autonomy)
- Item 6 abuse/cost: per-shop daily cap is now enforced (`lib/aiUsage.ts`);
  **Supabase auth rate-limit tightening is still a manual dashboard step.**
- Promote the tenant-isolation probe into a repeatable script against a
  dedicated QA project (so it can run without touching the live tenant).
