-- Sprint 48 · step 2 of 3 — verify the journey_runs collision resolved.
--
-- Run AFTER merging Test Alpha into Test Bravo at /dashboard/customers/merge
-- (survivor = Bravo, absorbed = Alpha).
--
-- Every column has one correct answer:
--
--   runs_on_survivor        1   2 means the unique key should have fired and
--                               didn't; 0 means both runs were destroyed.
--   actions_on_survivor     2   1 means the cascade ate an action — the exact
--                               bug 0025 is written to prevent.
--   surviving_run_age_days 10   Alpha enrolled 10 days ago, Bravo 2. Ten proves
--                               the EARLIER enrollment survived, which is the
--                               rule; two would mean the later one won.
--   alpha_remaining         0   the absorbed record wasn't deleted.
--   orphaned_actions        0   an action still points at a deleted run.
--
-- surviving_run_age_days is the load-bearing one. The survivor enrolled later,
-- so a 10 means the ABSORBED customer's run is the one that lived and the
-- survivor's own action was moved off its run before that run was dropped —
-- the harder of the two branches.

select
  (select count(*) from journey_runs r
     join customers c on c.id = r.customer_id
    where c.email = 'bravo@sprint48.test')                     as runs_on_survivor,

  (select count(*) from journey_actions a
     join customers c on c.id = a.customer_id
    where c.email = 'bravo@sprint48.test')                     as actions_on_survivor,

  (select round(extract(epoch from now() - r.entered_at) / 86400)::int
     from journey_runs r
     join customers c on c.id = r.customer_id
    where c.email = 'bravo@sprint48.test' limit 1)             as surviving_run_age_days,

  (select count(*) from customers
    where email = 'alpha@sprint48.test')                       as alpha_remaining,

  (select count(*) from journey_actions a
    where not exists (select 1 from journey_runs r where r.id = a.run_id))
                                                               as orphaned_actions;
