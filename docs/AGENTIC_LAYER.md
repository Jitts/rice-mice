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
