# Security

## Secrets
- Supabase `service_role` key is **never** sent to the browser — server-only
- Only the `anon` public key is used client-side
- WhatsApp Business API token (when added) lives in Vercel environment variables, accessed only by server-side API routes
- No secrets in `.env.local` committed to version control

## Permission Model
| Sprint | Rule |
|---|---|
| v1 (demo) | Open RLS policies — any read/write allowed; suitable only for non-sensitive demo data |
| Lock-down | Staff login via Supabase Auth; dashboard routes require `session`; RLS policies check `auth.uid() = user_id` |
| Public form | Always unauthenticated; writes `user_id = null`; isolated from staff-owned rows at lock-down |

## Approved Tools Rule
- No `run_any` or `eval` patterns
- Every external call (WhatsApp, email) goes through a named, reviewed server-side function
- Agent actions inherit the logged-in staff member's permissions — they cannot exceed them

## Audit Principle
- Every state-changing action (insert, update, send) writes an audit record: actor, action, target, timestamp, outcome
- Audit records are append-only; no delete policy on audit table
- Before activating WhatsApp API or any send tool: stop and have a human review the integration — do not self-certify production readiness
