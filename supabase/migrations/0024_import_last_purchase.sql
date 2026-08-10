-- Sprint 47: set-based last_purchase_date maintenance for the order import.
--
-- Both the import commit and its undo walked their affected customers one at a
-- time — a single-row UPDATE per person, awaited in sequence. Measured in prod
-- on 2026-08-10: a 281-order file touching 129 customers took ~40s wall clock,
-- almost all of it in those ~127 round trips, and the undo ~25-40s the same way.
-- It scales linearly, so a shop importing 5,000 orders across 800 customers
-- would run for minutes and risk the serverless timeout — and none of the
-- import is transactional, so a timeout leaves a half-finished import behind.
--
-- These functions collapse each pass into one statement. All three are
-- service-role only: the import actions run under the admin client, which has
-- already checked the caller's permissions, and each takes the business id as
-- an explicit argument so the tenant fence lives inside the SQL rather than
-- being trusted from a session. They are deliberately NOT security definer —
-- service_role bypasses RLS on its own, so leaving them invoker-rights means
-- that granting one to `authenticated` later could not turn it into an RLS hole.

-- --- Import: move last_purchase_date FORWARD only -----------------------------
-- Old history must never rewind someone whose most recent visit was rung up in
-- the app. That rule now lives in the WHERE clause instead of a read-then-write
-- in the action, which also closes a race: an order taken between the read and
-- the write can no longer be overwritten by a file of older receipts.
--
-- p_updates is [{"customer_id": "<uuid>", "visited_at": "<timestamptz>"}, ...].
-- Returns the number of customers actually moved forward.
create or replace function import_touch_last_purchase(
  p_business uuid,
  p_updates  jsonb
) returns integer
language plpgsql
set search_path = public
as $$
declare
  moved integer;
begin
  update customers c
     set last_purchase_date = u.visited_at
    from jsonb_to_recordset(p_updates) as u(customer_id uuid, visited_at timestamptz)
   where c.id = u.customer_id
     and c.business_id = p_business
     and (c.last_purchase_date is null or c.last_purchase_date < u.visited_at);
  get diagnostics moved = row_count;
  return moved;
end;
$$;

-- --- Undo: recompute last_purchase_date from the orders that REMAIN -----------
-- Called after the batch's orders are deleted. The import moved the value
-- forward and the previous value was never recorded, so recomputing from what
-- is left is the only honest answer — and it is the right one whether the
-- customer's real last visit predates the import, was rung up in the app since,
-- or no longer exists at all. No completed orders left means NULL, which is what
-- "has never bought anything" means everywhere else in the app.
--
-- Returns the number of customers whose value actually changed.
create or replace function recompute_last_purchase(
  p_business  uuid,
  p_customers uuid[]
) returns integer
language plpgsql
set search_path = public
as $$
declare
  changed integer;
begin
  update customers c
     set last_purchase_date = latest.visited_at
    from (
      select target.id, max(o.created_at) as visited_at
        from unnest(p_customers) as target(id)
        left join orders o
          on o.customer_id = target.id
         and o.business_id = p_business
         and o.status = 'completed'
       group by target.id
    ) as latest
   where c.id = latest.id
     and c.business_id = p_business
     and c.last_purchase_date is distinct from latest.visited_at;
  get diagnostics changed = row_count;
  return changed;
end;
$$;

-- --- The done screen's stage breakdown, as an aggregate ------------------------
-- The import's last step reports how many customers now sit in each lifecycle
-- stage. It used to compute that by selecting every customer, every order, and
-- every order LINE for the business and rebuilding full profiles in JS — to
-- render five numbers.
--
-- Deciding the stage stays in TypeScript (lib/segments.ts `stageOf`), so the
-- thresholds have one definition and cannot drift between SQL and app code.
-- This returns only its two inputs, one row per customer. The COALESCE mirrors
-- buildProfiles exactly: the maintained last_purchase_date wins, and the newest
-- completed order is the fallback for a customer who has none.
create or replace function customer_visit_aggregate(p_business uuid)
returns table (customer_id uuid, order_count bigint, last_visit timestamptz)
language sql
stable
set search_path = public
as $$
  select c.id,
         count(o.id),
         coalesce(c.last_purchase_date, max(o.created_at))
    from customers c
    left join orders o
      on o.customer_id = c.id
     and o.business_id = p_business
     and o.status = 'completed'
   where c.business_id = p_business
   group by c.id, c.last_purchase_date;
$$;

revoke all on function import_touch_last_purchase(uuid, jsonb) from public;
revoke all on function recompute_last_purchase(uuid, uuid[]) from public;
revoke all on function customer_visit_aggregate(uuid) from public;
grant execute on function import_touch_last_purchase(uuid, jsonb) to service_role;
grant execute on function recompute_last_purchase(uuid, uuid[]) to service_role;
grant execute on function customer_visit_aggregate(uuid) to service_role;

-- Serves both reads above: each groups one business's COMPLETED orders by
-- customer. orders had indexes on business_id and on status separately, neither
-- of which answers that shape well.
create index if not exists orders_business_customer_completed_idx
  on orders (business_id, customer_id, created_at desc)
  where status = 'completed';
