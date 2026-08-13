-- Sprint 50 — one row per customer, so pages stop downloading the orders table.
--
-- Five dashboard pages currently read `orders` with `*, order_items(*)` and no
-- bound, ship the whole thing to the browser, and rebuild profiles there with
-- buildProfiles (lib/segments.ts:101). Two problems, and the second is worse:
-- the payload grows with the shop's entire history, and Supabase caps every
-- read at 1,000 rows without saying so, which Sprint 49 established is silent.
--
-- Every one of those pages needs only the PER-CUSTOMER roll-up. This computes
-- it in the database: one row per customer instead of one row per order line.
--
-- SECURITY INVOKER, like 0024's three, but the fence works differently and the
-- difference matters. 0024's functions are service_role only, so `p_business`
-- IS the tenant boundary. This one is called by the dashboard's RLS-scoped
-- client on behalf of a signed-in user, so RLS on customers/orders/order_items
-- is the real fence: invoker rights mean a caller who passes someone else's
-- business id sees nothing, because the underlying policies filter it out.
-- `p_business` is here to narrow the scan, not to protect it — do not
-- "optimise" it into a security definer.
--
-- ---------------------------------------------------------------------------
-- NOTE ON THE BODY: it carries no `--` comments, deliberately. The Supabase SQL
-- editor splits pasted input into statements with a splitter that tracks single
-- quotes but does NOT skip `--` comments, so one apostrophe in a body comment
-- ("today's") flips its quote state and it then treats the first semicolon it
-- believes is unquoted as the end of the statement — cutting the function off
-- before its closing dollar tag. That is what "unterminated dollar-quoted
-- string" means here; the file was always valid Postgres. Migration 0025 only
-- escaped it because its comment apostrophes happened to come in pairs. Keep
-- the prose out here, where nothing has to parse it.
-- ---------------------------------------------------------------------------
--
-- What the body does, in the order it does it:
--
-- 1. `ord` aggregates at ORDER level. It does not touch order_items, because
--    joining lines into the same aggregate multiplies each order by its line
--    count and would inflate both the count and the sum — silently, and only
--    for receipts with more than one item.
--    `coalesce(o.total_cents, 0)` mirrors buildProfiles reading
--    `o.total_cents ?? 0` (lib/segments.ts:127), so a null total contributes
--    zero rather than voiding the whole sum.
--
-- 2. `qty` aggregates at LINE level, one row per (customer, item).
--
-- 3. `items` collects the distinct item names, sorted. buildProfiles returns
--    them in first-seen order; every consumer does a membership test, so the
--    difference carries no meaning, and the parity test compares them as sets.
--
-- 4. `fav` picks the highest total quantity, breaking ties alphabetically.
--    buildProfiles breaks ties by Map insertion order (lib/segments.ts:147),
--    which follows whatever order the caller passed its orders in — so the
--    current answer for a tie is unspecified rather than merely different.
--    This makes it deterministic, and changes the item shown for a customer
--    whose top two items are exactly level.
--
-- 5. The final select rounds the average the way JS does. Postgres round() on
--    numeric is half-away-from-zero and Math.round is half-up; they agree for
--    the non-negative totals this column can hold.
--
-- lastVisit is NOT computed here. buildProfiles resolves it as
-- `last_purchase_date ?? newest completed order` (lib/segments.ts:157), and
-- last_purchase_date is a maintained column the caller already has on the
-- customer row. Returning the raw newest order keeps that rule in one place
-- instead of two — the same reason 0024 left stageOf in TypeScript.

create or replace function customer_profile_aggregate(p_business uuid)
returns table (
  customer_id uuid,
  order_count bigint,
  total_spent_cents bigint,
  avg_order_cents integer,
  newest_completed_at timestamptz,
  favourite_item text,
  items_purchased text[],
  payment_methods text[]
)
language sql
stable
set search_path = public
as $fn$
  with ord as (
    select o.customer_id,
           count(*)                                       as order_count,
           coalesce(sum(coalesce(o.total_cents, 0)), 0)   as total_spent_cents,
           max(o.created_at)                              as newest_completed_at,
           array_agg(distinct o.payment_method)
             filter (where o.payment_method is not null
                       and o.payment_method <> '')        as payment_methods
      from orders o
     where o.business_id = p_business
       and o.status = 'completed'
       and o.customer_id is not null
     group by o.customer_id
  ),
  qty as (
    select o.customer_id, l.item_name, sum(l.quantity) as qty
      from orders o
      join order_items l on l.order_id = o.id
     where o.business_id = p_business
       and o.status = 'completed'
       and o.customer_id is not null
     group by o.customer_id, l.item_name
  ),
  items as (
    select q.customer_id, array_agg(q.item_name order by q.item_name) as items_purchased
      from qty q
     group by q.customer_id
  ),
  fav as (
    select distinct on (q.customer_id) q.customer_id, q.item_name as favourite_item
      from qty q
     order by q.customer_id, q.qty desc, q.item_name
  )
  select c.id,
         coalesce(o.order_count, 0),
         coalesce(o.total_spent_cents, 0),
         case
           when coalesce(o.order_count, 0) > 0
             then round(o.total_spent_cents::numeric / o.order_count)::integer
           else 0
         end,
         o.newest_completed_at,
         f.favourite_item,
         coalesce(i.items_purchased, '{}'),
         coalesce(o.payment_methods, '{}')
    from customers c
    left join ord   o on o.customer_id = c.id
    left join items i on i.customer_id = c.id
    left join fav   f on f.customer_id = c.id
   where c.business_id = p_business;
$fn$;

revoke all on function customer_profile_aggregate(uuid) from public;

-- Granted to authenticated, unlike 0024's service_role-only three: the pages
-- that need this run as the signed-in user. See the header on why that is safe.
grant execute on function customer_profile_aggregate(uuid) to authenticated;
grant execute on function customer_profile_aggregate(uuid) to service_role;

-- The line-level CTE walks order_items for every completed order in the
-- business. order_items had only an index on order_id, which answers the join
-- but leaves item_name and quantity to a heap fetch per row. This covers the
-- group-by so the whole CTE can be served from the index.
create index if not exists order_items_order_item_name_idx
  on order_items (order_id, item_name) include (quantity);
