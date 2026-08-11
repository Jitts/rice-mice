-- Sprint 48 · step 1 of 3 — seed the journey_runs collision.
--
-- NOT a migration. This is a throwaway probe, run by hand in the Supabase SQL
-- editor. It must never live in supabase/migrations/, or every fresh database
-- would come up with test data in it.
--
-- Why it exists: merge_customers (0025) has one branch the test suite cannot
-- reach. journey_runs carries unique (journey_id, customer_id) from Sprint 7 —
-- one enrollment per customer per journey, ever — so merging two customers who
-- both sit in the same journey means one run has to go. The actions hanging off
-- it would go with it, because journey_actions.run_id cascades, so the merge
-- moves those actions onto the surviving run FIRST and only then deletes the
-- loser. Losing the record of a message that was really sent is not an
-- acceptable side effect of tidying up a duplicate.
--
-- Nothing here can touch real data. The journey is created as `draft`, and
-- runJourneyTick (lib/journeyExecutor.ts) selects only status = 'running', so
-- it can never enroll a real customer or prepare a single message.
--
-- Deliberately asymmetric: Alpha enrolls 10 days ago, Bravo 2 days ago. Merging
-- Alpha INTO Bravo then makes the survivor the one who enrolled LATER, which
-- forces the harder branch — the absorbed customer's run is the one that must
-- survive, so the survivor's own action has to be moved off its run before that
-- run is deleted.
--
-- Prerequisite: run scripts/sprint48/pos-only.csv through the order importer
-- with "Add the people this file names as customers" ticked.

do $$
declare
  v_biz uuid; v_alpha uuid; v_bravo uuid;
  v_journey uuid; v_run_a uuid; v_run_b uuid;
begin
  select id, business_id into v_alpha, v_biz
    from customers where email = 'alpha@sprint48.test' limit 1;
  select id into v_bravo
    from customers where email = 'bravo@sprint48.test' limit 1;
  if v_alpha is null or v_bravo is null then
    raise exception 'test customers not found - run the import first';
  end if;

  insert into journeys (business_id, name, status, created_by)
  values (v_biz, 'S48 collision probe', 'draft', 'sprint48-test')
  returning id into v_journey;

  insert into journey_runs (business_id, journey_id, customer_id, entered_at, status)
  values (v_biz, v_journey, v_alpha, now() - interval '10 days', 'active')
  returning id into v_run_a;

  insert into journey_runs (business_id, journey_id, customer_id, entered_at, status)
  values (v_biz, v_journey, v_bravo, now() - interval '2 days', 'active')
  returning id into v_run_b;

  insert into journey_actions (business_id, run_id, journey_id, customer_id, kind, payload, status)
  values
    (v_biz, v_run_a, v_journey, v_alpha, 'message', '{"probe":"alpha"}'::jsonb, 'pending'),
    (v_biz, v_run_b, v_journey, v_bravo, 'message', '{"probe":"bravo"}'::jsonb, 'pending');

  raise notice 'journey % run_a % run_b %', v_journey, v_run_a, v_run_b;
end $$;
