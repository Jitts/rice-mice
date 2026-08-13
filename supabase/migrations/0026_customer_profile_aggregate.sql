-- Sprint 50 — per-customer roll-up, so pages stop downloading the orders table.
--
-- One row per customer instead of one per order line. Replaces the unbounded
-- `orders select("*, order_items(*)")` that five dashboard pages ship to the
-- browser to rebuild profiles with buildProfiles (lib/segments.ts:101).
--
-- Design notes, the two deliberate differences from buildProfiles, and why this
-- is SECURITY INVOKER rather than definer: docs/TASKS.md, Sprint 50 Part 1.
-- Kept short on purpose — a long body is awkward to paste into the SQL editor.

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
           count(*) as order_count,
           coalesce(sum(coalesce(o.total_cents, 0)), 0) as total_spent_cents,
           max(o.created_at) as newest_completed_at,
           array_agg(distinct o.payment_method)
             filter (where o.payment_method is not null
                       and o.payment_method <> '') as payment_methods
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
    select q.customer_id,
           array_agg(q.item_name order by q.item_name) as items_purchased
      from qty q
     group by q.customer_id
  ),
  fav as (
    select distinct on (q.customer_id)
           q.customer_id, q.item_name as favourite_item
      from qty q
     order by q.customer_id, q.qty desc, q.item_name
  )
  select c.id,
         coalesce(o.order_count, 0),
         coalesce(o.total_spent_cents, 0),
         case when coalesce(o.order_count, 0) > 0
              then round(o.total_spent_cents::numeric / o.order_count)::integer
              else 0 end,
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
grant execute on function customer_profile_aggregate(uuid) to authenticated;
grant execute on function customer_profile_aggregate(uuid) to service_role;

create index if not exists order_items_order_item_name_idx
  on order_items (order_id, item_name) include (quantity);
