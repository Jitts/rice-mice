# Agentic Layer

## Risk Levels & Actions

### Low risk — auto-execute
- Compute loyalty score from transaction history
- Flag customer as 'At Risk' (no purchase in 30 days)
- Tag sign-up source from referral code

### Medium risk — staff approval before execute
- Draft a WhatsApp re-engagement message for a customer
- Update customer segment tag (e.g. 'VIP', 'Lapsed')
- Create a follow-up task for a staff member

### High risk — explicit approval required, logged
- Send a WhatsApp message via WhatsApp Business API
- Bulk message a customer segment

### Critical — human-only, never automated
- Delete a customer record
- Refund a transaction
- Export full customer database

## Approval Flow (medium/high)
`Draft created` → `Staff reviews in dashboard` → `Staff clicks Approve` → `Action executes` → `Audit log entry written`

## Named Tools (v1 — none active; listed for later)
- `send_whatsapp_message(customer_id, message_text)` — high risk
- `draft_reengagement_message(customer_id)` — medium risk, AI-generated
- `compute_loyalty_score(customer_id)` — low risk, auto

## Audit Log Fields (every meaningful action)
| Field | Value |
|---|---|
| actor | staff name or 'system' |
| action | e.g. 'message.sent', 'customer.created' |
| target_id | customer_id or transaction_id |
| payload_snapshot | JSON of what was sent/changed |
| outcome | 'success' / 'failed' |
| created_at | timestamptz |

## v1 vs Later
- **v1:** no agentic actions execute; structure is defined and ready
- **Later:** draft + approval UI, WhatsApp API integration, audit log table

## Status — Sprint 35 (the ladder is live)
The ladder is now enforced in code, not just documented:
- **Registry:** `lib/agentic.ts` classifies every conceivable agent action into
  `auto` / `ask` / `locked`, tested by `tests/agentic.test.ts` (CI).
- **Locked forever (critical, human-only):** delete customer, refund a
  transaction, export the full customer database, and ANY message send
  (including bulk — our stance is stricter than the original "high risk"
  bulk-message row above: no agent has a send path). The executor refuses these
  server-side; unknown types fail closed too.
- **First executing action (`ask` rung):** `tag.apply` / `tag.remove`. The
  Reports "quiet regulars" finding proposes tagging the exact computed at-risk
  cohort "win-back"; a human reviews the named list and approves; the executor
  (`app/actions/agentic.ts`) writes through the RLS client (tenant-safe by
  construction), gates on the `customers` permission, and writes an
  `audit_log` `agent.execute` row. Reversible.
- **Not yet:** no `auto` (unattended) action, and no persistent proposal queue —
  the human is present for every execution. Those are the next deliberate rungs.
