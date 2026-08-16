# Sprint 51 — cap probe

Two receipts, each aimed at one of the reads Sprint 51 completed. Run with
**Max rows set to 10** in the Supabase dashboard (Data API → Settings).

| Receipt | Aimed at | Correct preview |
|---|---|---|
| `S51-CAP-1` | the customers read | **attached** to an existing customer, 0 to create |
| `R-1484` | the `import_ref` read | **skipped**, already imported |

Both anchors are deliberately deep in the paging order, so a truncated read
cannot see them:

- the customer sits at position **256 of 304** by `id` — page 26 of 31 at cap 10
- `R-1484` sits at position **150 of 281** by `import_ref` — page 16 of 29

**What the old code did.** With a bare `select`, the wizard saw only the first
10 of each. So `S51-CAP-1` would read as a customer to CREATE (a duplicate of
someone already on file), and `R-1484` would read as a new receipt — turning
idempotency off in the preview. Neither would have corrupted data: the commit
path re-runs the pure core server-side and has had `readAll` since Sprint 49.
The damage is that the numbers a person approves stop describing what happens.

Contains one real customer's name, phone and email, which is why the identity
is not repeated in the docs. Re-derive it with the query in the sprint notes if
this file is ever regenerated.
