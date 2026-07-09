# Intelligence Layer

## Messy Inputs → Structured Data
| Raw input | Structured field |
|---|---|
| Free-text phone entry | Normalised to E.164 format (server-side) |
| Sign-up source (QR scan, link, word-of-mouth) | `signup_events.source` enum |
| Purchase history | `transactions` rows aggregated to `loyalty_score` |

## Events to Track
- `customer.created` — new sign-up form submitted
- `transaction.created` — sale logged by staff
- `whatsapp_link.opened` — opt-in deep-link fired
- `engagement.sent` — message dispatched (later)

## Scoring Rules (v1 — rule-based, no AI)
```
loyalty_score = (transaction_count × 1) + floor(total_spend_cents / 10000)
at_risk = last_purchase_date < now() - 30 days AND loyalty_score > 0
```
Scores are computed on read (SQL query) in v1; materialised column added if performance demands it.

## What Gets Ranked
- Customers sorted by `loyalty_score DESC` on dashboard
- "At Risk" customers surfaced with a flag when last purchase > 30 days ago

## AI Fields (later sprints)
```json
{
  "message_draft": "Hi Amara! We miss you at rice-mice. Come back this week for 10% off.",
  "message_draft_source": "gpt-4o",
  "message_draft_confidence": 0.87,
  "message_draft_review_status": "unreviewed"
}
```
No AI draft is sent without a human changing `review_status` to `approved`.

## v1 vs Later
- **v1:** rule-based scoring, at-risk flag, source tracking
- **Later:** AI message drafts, segment auto-tagging, campaign ROI scoring
