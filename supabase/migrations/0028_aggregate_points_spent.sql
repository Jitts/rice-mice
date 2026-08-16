-- Sprint 54 — adds reward_points_spent. Notes in docs/TASKS.md.

drop function if exists customer_profile_aggregate(uuid);

create function customer_profile_aggregate(p_business uuid)
returns table (
  customer_id uuid,
  order_count bigint,
  total_spent_cents bigint,
  avg_order_cents integer,
  newest_completed_at timestamptz,
  favourite_item text,
  items_purchased text[],
  payment_methods text[],
  reward_points_spent bigint
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
  spent as (
    select o.customer_id,
           coalesce(sum(coalesce(o.reward_points_spent, 0)), 0) as pts
      from orders o
     where o.business_id = p_business
       and o.status <> 'cancelled'
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
         coalesce(o.payment_methods, '{}'),
         coalesce(s.pts, 0)
    from customers c
    left join ord   o on o.customer_id = c.id
    left join spent s on s.customer_id = c.id
    left join items i on i.customer_id = c.id
    left join fav   f on f.customer_id = c.id
   where c.business_id = p_business;
$fn$;

revoke all on function customer_profile_aggregate(uuid) from public;
grant execute on function customer_profile_aggregate(uuid) to authenticated;
grant execute on function customer_profile_aggregate(uuid) to service_role;
