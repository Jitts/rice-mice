# Data Model

## customers
| Field | Type | Notes |
|---|---|---|
| id | uuid PK | gen_random_uuid() |
| user_id | uuid nullable | owner-scope added at lock-down |
| created_at | timestamptz | default now() |
| first_name | text | required |
| last_name | text | required |
| phone | text | |
| email | text | |
| whatsapp_opt_in | boolean | default false |
| loyalty_score | numeric | rule-based, computed |
| last_purchase_date | timestamptz | |
| last_contacted_at | timestamptz | |
| notes | text | |

## transactions
| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| user_id | uuid nullable | |
| created_at | timestamptz | |
| customer_id | uuid FK → customers | |
| item_description | text | |
| amount_cents | integer | store in cents |
| payment_method | text | |
| staff_name | text | |

## signup_events
| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| user_id | uuid nullable | |
| created_at | timestamptz | |
| customer_id | uuid FK → customers | |
| source | text | e.g. 'in-store QR', 'instagram' |
| whatsapp_link_opened | boolean | |
| referral_code | text | |

## engagement_logs (AI fields flagged)
| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| user_id | uuid nullable | |
| created_at | timestamptz | |
| customer_id | uuid FK → customers | |
| channel | text | 'whatsapp', 'email' |
| message_draft | text | **AI-generated** |
| message_draft_source | text | e.g. 'gpt-4o' |
| message_draft_confidence | numeric | 0–1 |
| message_draft_review_status | text | default 'unreviewed' |
| sent_at | timestamptz | null until approved + sent |
| sent_by | text | staff name |
| outcome | text | 'opened', 'replied', 'ignored' |

## RLS
- v1: all tables have open read + write policies (demo-first)
- Lock-down sprint: replace with `auth.uid() = user_id` owner policies
- Public sign-up form always writes as anonymous (user_id = null until auth sprint)
