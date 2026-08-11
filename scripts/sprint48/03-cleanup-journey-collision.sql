-- Sprint 48 · step 3 of 3 — remove the probe.
--
-- Deletes the draft journey, which cascades its journey_runs and, through them,
-- their journey_actions. Nothing else in the shop references it.
--
-- The test CUSTOMERS and their orders are not touched here — undo the import
-- batch from /dashboard/orders/import instead, which is itself the thing being
-- exercised: an orders batch that created customers has to remove them too.
--
-- Safe to run twice; the delete simply matches nothing the second time.

delete from journeys where name = 'S48 collision probe';

-- Should both be zero afterwards.
select
  (select count(*) from journeys where name = 'S48 collision probe') as probe_journeys_left,
  (select count(*) from journey_actions a
    where not exists (select 1 from journey_runs r where r.id = a.run_id)) as orphaned_actions;
