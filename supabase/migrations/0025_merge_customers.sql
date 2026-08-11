-- Sprint 48: merging two customer records into one, in a single transaction.
--
-- Six tables hold a customer_id and they behave in three different ways:
--   orders, signup_events, engagement_logs — plain FK, no cascade
--   journey_runs, journey_actions          — on delete cascade
--   transactions                           — dead since Sprint 6, dropped below
--
-- Doing this from the server action would be seven round trips with nothing
-- transactional around them, and a half-finished merge is far worse than a
-- half-finished import: orders on one record, messages on another, and no way
-- to tell which half ran. A function gets an implicit transaction, which is the
-- entire reason this lives in SQL.
--
-- What does NOT live here: the rules for which field wins. Those are in
-- lib/customerMerge.ts and arrive as p_fields, for the same reason Sprint 47
-- left stage classification in TypeScript — one definition, no drift between
-- SQL and app code. This function does the set-based mechanics only.
--
-- Service-role only and NOT security definer, following 0024: service_role
-- bypasses RLS on its own, so invoker rights mean granting this to
-- `authenticated` later could not turn it into an RLS hole. The tenant fence is
-- p_business, checked against BOTH customers before anything moves.

create or replace function merge_customers(
  p_business uuid,
  p_survivor uuid,
  p_absorbed uuid,
  p_fields   jsonb
) returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_orders           integer := 0;
  v_signups          integer := 0;
  v_logs             integer := 0;
  v_runs_moved       integer := 0;
  v_runs_dropped     integer := 0;
  v_actions_moved    integer := 0;
  v_absorbed_snapshot jsonb;
begin
  if p_survivor = p_absorbed then
    raise exception 'A customer cannot be merged into itself';
  end if;

  -- BOTH ids are proven to belong to the caller's business before a single row
  -- moves. Checking only the survivor would let a crafted request name another
  -- tenant's customer as the absorbed one and pull their orders across. The two
  -- failure messages are identical on purpose, so a caller probing for ids
  -- learns nothing from which one fired.
  perform 1 from customers
   where id = p_survivor and business_id = p_business;
  if not found then
    raise exception 'That customer is not one of yours';
  end if;

  select to_jsonb(c) into v_absorbed_snapshot
    from customers c
   where c.id = p_absorbed and c.business_id = p_business;
  if v_absorbed_snapshot is null then
    raise exception 'That customer is not one of yours';
  end if;

  -- --- journey_runs: unique (journey_id, customer_id) ------------------------
  -- Sprint 7 made enrollment one-per-customer-per-journey, ever, which is what
  -- makes the journey tick idempotent. When both customers sat in the same
  -- journey, one run has to go — and the actions hanging off it would go with
  -- it, because journey_actions.run_id cascades. So the actions are moved onto
  -- the run that stays FIRST, and only then is the loser deleted. Losing the
  -- record of a message that was actually sent is not an acceptable side effect
  -- of tidying up a duplicate.
  --
  -- The run that stays is the one that entered first: it is the true start of
  -- that person's time in the journey, whichever record it happened to be on.

  -- Survivor entered first (or at the same moment) — its run stays.
  update journey_actions a
     set run_id = s.id
    from journey_runs r
    join journey_runs s
      on s.journey_id = r.journey_id
     and s.customer_id = p_survivor
   where r.customer_id = p_absorbed
     and s.entered_at <= r.entered_at
     and a.run_id = r.id;
  get diagnostics v_actions_moved = row_count;

  -- Absorbed entered first — its run stays, so the survivor's own actions move.
  update journey_actions a
     set run_id = r.id
    from journey_runs r
    join journey_runs s
      on s.journey_id = r.journey_id
     and s.customer_id = p_survivor
   where r.customer_id = p_absorbed
     and r.entered_at < s.entered_at
     and a.run_id = s.id;

  delete from journey_runs r
   using journey_runs s
   where r.customer_id = p_absorbed
     and s.customer_id = p_survivor
     and s.journey_id = r.journey_id
     and s.entered_at <= r.entered_at;
  get diagnostics v_runs_dropped = row_count;

  delete from journey_runs s
   using journey_runs r
   where s.customer_id = p_survivor
     and r.customer_id = p_absorbed
     and r.journey_id = s.journey_id
     and r.entered_at < s.entered_at;

  -- Whatever is left has no counterpart on the survivor, so it moves wholesale.
  -- Exactly one run per journey remains by now, so the unique key cannot fire.
  update journey_runs set customer_id = p_survivor
   where customer_id = p_absorbed and business_id = p_business;
  get diagnostics v_runs_moved = row_count;

  update journey_actions set customer_id = p_survivor
   where customer_id = p_absorbed and business_id = p_business;

  -- --- The plain repoints ---------------------------------------------------
  -- signup_events carries the consent provenance — source, referral code, when
  -- they signed up — so moving it is what keeps an inherited opt-in defensible
  -- after the absorbed row is gone.
  update orders set customer_id = p_survivor
   where customer_id = p_absorbed and business_id = p_business;
  get diagnostics v_orders = row_count;

  update signup_events set customer_id = p_survivor
   where customer_id = p_absorbed and business_id = p_business;
  get diagnostics v_signups = row_count;

  update engagement_logs set customer_id = p_survivor
   where customer_id = p_absorbed and business_id = p_business;
  get diagnostics v_logs = row_count;

  -- --- The survivor's own row -----------------------------------------------
  -- Every value is computed in TypeScript and applied here by name. No dynamic
  -- SQL: a jsonb payload turned into column names would be exactly the
  -- `run_any` pattern SECURITY.md rules out. Each NOT NULL column falls back to
  -- what the survivor already has, so a short payload can never blank a field
  -- or silently switch an opt-in off.
  update customers c
     set first_name         = coalesce(nullif(p_fields->>'first_name', ''), c.first_name),
         last_name          = coalesce(p_fields->>'last_name', c.last_name),
         phone              = nullif(p_fields->>'phone', ''),
         email              = nullif(p_fields->>'email', ''),
         birthday           = (nullif(p_fields->>'birthday', ''))::date,
         notes              = nullif(p_fields->>'notes', ''),
         last_purchase_date = (nullif(p_fields->>'last_purchase_date', ''))::timestamptz,
         last_contacted_at  = (nullif(p_fields->>'last_contacted_at', ''))::timestamptz,
         created_at         = coalesce((nullif(p_fields->>'created_at', ''))::timestamptz, c.created_at),
         tags               = coalesce(
                                (select array_agg(t) from jsonb_array_elements_text(p_fields->'tags') as t),
                                c.tags),
         custom_fields      = coalesce(p_fields->'custom_fields', c.custom_fields),
         whatsapp_opt_in    = coalesce((p_fields->>'whatsapp_opt_in')::boolean, c.whatsapp_opt_in),
         email_opt_in       = coalesce((p_fields->>'email_opt_in')::boolean, c.email_opt_in),
         sms_opt_in         = coalesce((p_fields->>'sms_opt_in')::boolean, c.sms_opt_in)
   where c.id = p_survivor and c.business_id = p_business;

  delete from customers where id = p_absorbed and business_id = p_business;

  -- The snapshot goes back to the caller rather than being written here: the
  -- action owns audit_log, and this way the absorbed customer's opt-in state
  -- and their now-dead unsubscribe_token land in the audit row as one payload.
  return jsonb_build_object(
    'orders_moved', v_orders,
    'signup_events_moved', v_signups,
    'engagement_logs_moved', v_logs,
    'journey_runs_moved', v_runs_moved,
    'journey_runs_dropped', v_runs_dropped,
    'journey_actions_moved', v_actions_moved,
    'absorbed', v_absorbed_snapshot
  );
end;
$$;

revoke all on function merge_customers(uuid, uuid, uuid, jsonb) from public;
grant execute on function merge_customers(uuid, uuid, uuid, jsonb) to service_role;

-- Serves the repoints above, all of which are "this customer's rows in this
-- business". orders already has one from 0024; these two do not.
create index if not exists signup_events_business_customer_idx
  on signup_events (business_id, customer_id);
create index if not exists engagement_logs_business_customer_idx
  on engagement_logs (business_id, customer_id);

-- --- Retiring `transactions` ---------------------------------------------------
-- 0003 turned every transaction into a completed single-line order, reusing the
-- transaction id as the order id and moving item_description into
-- order_items.item_name. Its own header says it stays "until Sprint 7 retires
-- it"; Sprint 7 never did. Nothing in the codebase has read it since — there is
-- no `.from("transactions")` anywhere — but its FK to customers has no cascade,
-- so it silently blocks every customer delete, including this merge.
--
-- This is the only irreversible statement in the file, so it proves the backfill
-- is complete before it runs rather than trusting a migration from Sprint 6.
do $$
declare
  v_orphans bigint;
begin
  if to_regclass('public.transactions') is null then
    return;
  end if;

  select count(*) into v_orphans
    from transactions t
   where not exists (select 1 from orders o where o.id = t.id);

  if v_orphans > 0 then
    raise exception
      'transactions still holds % row(s) with no matching order — not dropping it', v_orphans;
  end if;

  drop table transactions;
end $$;
