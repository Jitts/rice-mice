-- Sprint 28: the marketing rules (lifecycle + attribution thresholds) become
-- editable in Settings. Stored on the business_settings singleton; defaults
-- are exactly the constants the engines shipped with, so existing behaviour
-- is unchanged until an owner edits them. Bounds mirror lib/marketing.ts.

alter table business_settings
  add column if not exists attribution_window_days int not null default 14
    check (attribution_window_days between 1 and 365),
  add column if not exists at_risk_days int not null default 30
    check (at_risk_days between 1 and 365),
  add column if not exists churn_days int not null default 90
    check (churn_days between 2 and 730),
  add column if not exists loyal_min_orders int not null default 3
    check (loyal_min_orders between 1 and 100);

-- At-risk and churned are adjacent bands of the same timeline — churn must
-- start after at-risk ends or a customer could be both.
alter table business_settings
  drop constraint if exists marketing_windows_ordered;
alter table business_settings
  add constraint marketing_windows_ordered check (churn_days > at_risk_days);
