-- Sprint 30: the loyalty earning criteria become editable in Settings.
-- Stored on the business_settings singleton like the marketing rules (0014);
-- defaults are exactly what the engine shipped with (1 point per completed
-- order, 1 point per $100 spent, no welcome bonus), so nothing changes until
-- an owner edits them. A value of 0 switches a criterion off. Bounds mirror
-- lib/loyalty.ts.

alter table business_settings
  add column if not exists loyalty_points_per_order int not null default 1
    check (loyalty_points_per_order between 0 and 1000),
  add column if not exists loyalty_cents_per_point int not null default 10000
    check (loyalty_cents_per_point = 0
           or loyalty_cents_per_point between 100 and 100000000),
  add column if not exists loyalty_signup_bonus_points int not null default 0
    check (loyalty_signup_bonus_points between 0 and 1000);

-- At least one way to earn must stay on, or every reward becomes dead UI.
alter table business_settings
  drop constraint if exists loyalty_earning_possible;
alter table business_settings
  add constraint loyalty_earning_possible check (
    loyalty_points_per_order > 0
    or loyalty_cents_per_point > 0
    or loyalty_signup_bonus_points > 0
  );

-- customers.loyalty_score has been dead since Sprint 7 — loyalty is always
-- derived from completed orders, nothing reads the column — and now that the
-- earning rules are editable, a stale stored score would be actively
-- misleading. Drop it.
alter table customers drop column if exists loyalty_score;
