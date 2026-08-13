# Data Model

Generated from the live schema by `scripts/schema-doc.sql` — do not hand-edit.
Design reasoning lives in DECISIONS.md and TASKS.md, not here.

## audit_log — RLS on · tenant-scoped via business_id

| Column | Type | Default | Notes |
|---|---|---|---|
| id | uuid | gen_random_uuid() | PK · not null |
| created_at | timestamp with time zone | now() | not null |
| business_id | uuid |  | → businesses on delete cascade · not null |
| actor | text |  | not null |
| action | text |  | not null |
| target_id | text |  |  |
| payload_snapshot | jsonb |  |  |
| outcome | text | 'success'::text | not null |

## businesses — RLS on

| Column | Type | Default | Notes |
|---|---|---|---|
| id | uuid | gen_random_uuid() | PK · not null |
| created_at | timestamp with time zone | now() | not null |
| slug | text |  | not null |
| updated_at | timestamp with time zone | now() | not null |
| updated_by | text |  |  |
| shop_name | text | 'My shop'::text | not null |
| shop_emoji | text | '🍚'::text | not null |
| tagline | text | 'Thanks for visiting'::text | not null |
| phone | text |  |  |
| address | text |  |  |
| receipt_footer | text | 'See you again!'::text | not null |
| attribution_window_days | integer | 14 | not null |
| at_risk_days | integer | 30 | not null |
| churn_days | integer | 90 | not null |
| loyal_min_orders | integer | 3 | not null |
| loyalty_points_per_order | integer | 1 | not null |
| loyalty_cents_per_point | integer | 10000 | not null |
| loyalty_signup_bonus_points | integer | 0 | not null |
| analyst_model | text |  |  |

## campaigns — RLS on · tenant-scoped via business_id

| Column | Type | Default | Notes |
|---|---|---|---|
| id | uuid | gen_random_uuid() | PK · not null |
| created_at | timestamp with time zone | now() | not null |
| name | text |  | not null |
| segment_id | uuid |  | → segments on delete set null |
| segment_name | text |  | not null |
| definition | jsonb |  | not null |
| channel | text |  | not null |
| subject | text |  |  |
| body | text |  | not null |
| recipient_count | integer | 0 | not null |
| created_by | text |  |  |
| completed_at | timestamp with time zone |  |  |
| offer_code | text |  |  |
| offer_type | text |  |  |
| offer_value | integer |  |  |
| business_id | uuid | current_business_id() | → businesses on delete cascade · not null |

## channel_providers — RLS on · tenant-scoped via business_id

| Column | Type | Default | Notes |
|---|---|---|---|
| id | text |  | PK · not null |
| enabled | boolean | false | not null |
| config | jsonb | '{}'::jsonb | not null |
| updated_at | timestamp with time zone | now() | not null |
| updated_by | text |  |  |
| business_id | uuid |  | PK · → businesses on delete cascade · not null |

## custom_fields — RLS on · tenant-scoped via business_id

| Column | Type | Default | Notes |
|---|---|---|---|
| id | uuid | gen_random_uuid() | PK · not null |
| created_at | timestamp with time zone | now() | not null |
| key | text |  | not null |
| label | text |  | not null |
| value_type | text |  | not null |
| sort_order | integer | 0 | not null |
| business_id | uuid | current_business_id() | → businesses on delete cascade · not null |

## customers — RLS on · tenant-scoped via business_id

| Column | Type | Default | Notes |
|---|---|---|---|
| id | uuid | gen_random_uuid() | PK · not null |
| user_id | uuid |  |  |
| created_at | timestamp with time zone | now() | not null |
| first_name | text |  | not null |
| last_name | text |  | not null |
| phone | text |  |  |
| email | text |  |  |
| whatsapp_opt_in | boolean | false |  |
| last_purchase_date | timestamp with time zone |  |  |
| last_contacted_at | timestamp with time zone |  |  |
| notes | text |  |  |
| email_opt_in | boolean | false | not null |
| birthday | date |  |  |
| tags | text[] | '{}'::text[] | not null |
| unsubscribe_token | uuid | gen_random_uuid() | not null |
| custom_fields | jsonb | '{}'::jsonb | not null |
| business_id | uuid | current_business_id() | → businesses on delete cascade · not null |
| sms_opt_in | boolean | false | not null |
| import_batch_id | uuid |  | → import_batches on delete set null |

## engagement_logs — RLS on · tenant-scoped via business_id

| Column | Type | Default | Notes |
|---|---|---|---|
| id | uuid | gen_random_uuid() | PK · not null |
| user_id | uuid |  |  |
| created_at | timestamp with time zone | now() | not null |
| customer_id | uuid |  | → customers |
| channel | text |  |  |
| message_draft | text |  |  |
| message_draft_source | text |  |  |
| message_draft_confidence | numeric |  |  |
| message_draft_review_status | text | 'unreviewed'::text |  |
| sent_at | timestamp with time zone |  |  |
| sent_by | text |  |  |
| outcome | text |  |  |
| campaign_id | uuid |  | → campaigns on delete cascade |
| journey_id | uuid |  | → journeys on delete set null |
| sent_via | text |  |  |
| business_id | uuid | current_business_id() | → businesses on delete cascade · not null |

## import_batches — RLS on · tenant-scoped via business_id

| Column | Type | Default | Notes |
|---|---|---|---|
| id | uuid | gen_random_uuid() | PK · not null |
| created_at | timestamp with time zone | now() | not null |
| business_id | uuid | current_business_id() | → businesses on delete cascade · not null |
| kind | text |  | not null |
| filename | text |  | not null |
| row_count | integer | 0 | not null |
| created_count | integer | 0 | not null |
| updated_count | integer | 0 | not null |
| skipped_count | integer | 0 | not null |
| created_by | text |  |  |

## items — RLS on · tenant-scoped via business_id

| Column | Type | Default | Notes |
|---|---|---|---|
| id | uuid | gen_random_uuid() | PK · not null |
| created_at | timestamp with time zone | now() | not null |
| name | text |  | not null |
| price_cents | integer |  | not null |
| category | text |  |  |
| is_active | boolean | true | not null |
| sort_order | integer | 0 | not null |
| business_id | uuid | current_business_id() | → businesses on delete cascade · not null |

## journey_actions — RLS on · tenant-scoped via business_id

| Column | Type | Default | Notes |
|---|---|---|---|
| id | uuid | gen_random_uuid() | PK · not null |
| created_at | timestamp with time zone | now() | not null |
| run_id | uuid |  | → journey_runs on delete cascade · not null |
| journey_id | uuid |  | → journeys on delete cascade · not null |
| customer_id | uuid |  | → customers on delete cascade · not null |
| kind | text | 'message'::text | not null |
| payload | jsonb |  | not null |
| status | text | 'pending'::text | not null |
| acted_at | timestamp with time zone |  |  |
| acted_by | text |  |  |
| business_id | uuid | current_business_id() | → businesses on delete cascade · not null |

## journey_runs — RLS on · tenant-scoped via business_id

| Column | Type | Default | Notes |
|---|---|---|---|
| id | uuid | gen_random_uuid() | PK · not null |
| journey_id | uuid |  | → journeys on delete cascade · not null |
| customer_id | uuid |  | → customers on delete cascade · not null |
| entered_at | timestamp with time zone | now() | not null |
| position | jsonb | '[]'::jsonb | not null |
| due_at | timestamp with time zone |  |  |
| status | text | 'active'::text | not null |
| business_id | uuid | current_business_id() | → businesses on delete cascade · not null |

## journeys — RLS on · tenant-scoped via business_id

| Column | Type | Default | Notes |
|---|---|---|---|
| id | uuid | gen_random_uuid() | PK · not null |
| created_at | timestamp with time zone | now() | not null |
| updated_at | timestamp with time zone | now() | not null |
| name | text |  | not null |
| definition | jsonb | '{"entry": {"type": "stage", "stage": "at_risk"}, "steps": [], "exitOnOrder": true}'::jsonb | not null |
| status | text | 'draft'::text | not null |
| launched_at | timestamp with time zone |  |  |
| run_until | timestamp with time zone |  |  |
| created_by | text |  |  |
| business_id | uuid | current_business_id() | → businesses on delete cascade · not null |

## memberships — RLS on · tenant-scoped via business_id

| Column | Type | Default | Notes |
|---|---|---|---|
| id | uuid | gen_random_uuid() | PK · not null |
| created_at | timestamp with time zone | now() | not null |
| business_id | uuid |  | → businesses on delete cascade · not null |
| user_id | uuid |  | → users on delete cascade · not null |
| role_id | uuid |  | → roles on delete set null |

## order_items — RLS on · tenant-scoped via business_id

| Column | Type | Default | Notes |
|---|---|---|---|
| id | uuid | gen_random_uuid() | PK · not null |
| created_at | timestamp with time zone | now() | not null |
| order_id | uuid |  | → orders on delete cascade · not null |
| item_id | uuid |  | → items |
| item_name | text |  | not null |
| unit_price_cents | integer |  | not null |
| quantity | integer | 1 | not null |
| business_id | uuid | current_business_id() | → businesses on delete cascade · not null |

## orders — RLS on · tenant-scoped via business_id

| Column | Type | Default | Notes |
|---|---|---|---|
| id | uuid | gen_random_uuid() | PK · not null |
| order_no | bigint |  | not null |
| created_at | timestamp with time zone | now() | not null |
| customer_id | uuid |  | → customers |
| status | text | 'open'::text | not null |
| payment_method | text |  |  |
| staff_name | text |  |  |
| total_cents | integer | 0 | not null |
| campaign_id | uuid |  | → campaigns on delete set null |
| discount_cents | integer | 0 | not null |
| reward_id | uuid |  | → rewards on delete set null |
| reward_points_spent | integer | 0 | not null |
| business_id | uuid | current_business_id() | → businesses on delete cascade · not null |
| import_ref | text |  |  |
| import_batch_id | uuid |  | → import_batches on delete set null |

## rewards — RLS on · tenant-scoped via business_id

| Column | Type | Default | Notes |
|---|---|---|---|
| id | uuid | gen_random_uuid() | PK · not null |
| name | text |  | not null |
| description | text |  |  |
| points_cost | integer |  | not null |
| benefit_type | text |  | not null |
| benefit_value | integer |  | not null |
| active | boolean | true | not null |
| created_at | timestamp with time zone | now() | not null |
| updated_at | timestamp with time zone | now() | not null |
| business_id | uuid | current_business_id() | → businesses on delete cascade · not null |

## roles — RLS on · tenant-scoped via business_id

| Column | Type | Default | Notes |
|---|---|---|---|
| id | uuid | gen_random_uuid() | PK · not null |
| created_at | timestamp with time zone | now() | not null |
| name | text |  | not null |
| description | text |  |  |
| permissions | text[] | '{}'::text[] | not null |
| is_system | boolean | false | not null |
| business_id | uuid | current_business_id() | → businesses on delete cascade · not null |

## segments — RLS on · tenant-scoped via business_id

| Column | Type | Default | Notes |
|---|---|---|---|
| id | uuid | gen_random_uuid() | PK · not null |
| created_at | timestamp with time zone | now() | not null |
| updated_at | timestamp with time zone | now() | not null |
| name | text |  | not null |
| definition | jsonb | '{"type": "group", "children": [], "combinator": "all"}'::jsonb | not null |
| is_starter | boolean | false | not null |
| created_by | text |  |  |
| business_id | uuid | current_business_id() | → businesses on delete cascade · not null |

## signup_events — RLS on · tenant-scoped via business_id

| Column | Type | Default | Notes |
|---|---|---|---|
| id | uuid | gen_random_uuid() | PK · not null |
| user_id | uuid |  |  |
| created_at | timestamp with time zone | now() | not null |
| customer_id | uuid |  | → customers |
| source | text |  |  |
| whatsapp_link_opened | boolean | false |  |
| referral_code | text |  |  |
| business_id | uuid | current_business_id() | → businesses on delete cascade · not null |

## staff_profiles — RLS on

| Column | Type | Default | Notes |
|---|---|---|---|
| id | uuid |  | PK · → users on delete cascade · not null |
| created_at | timestamp with time zone | now() | not null |
| display_name | text |  | not null |

