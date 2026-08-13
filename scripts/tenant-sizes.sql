-- Which shop is the biggest, and is it near the pagination trigger?
--
-- Run by hand in the Supabase SQL editor whenever you wonder. Read-only.
--
-- The dashboard already shows a shop its own customer count, so while there is
-- one shop this file is redundant — the Sign-ups stat card IS the number. It
-- earns its keep once there are several shops and the question becomes "which
-- one is largest", which no tenant-scoped page can answer.
--
-- See BACKLOG.md, "Dashboard pagination — TRIGGERED BY TENANT SIZE" for what
-- each band means. Short version: under 2,000 do nothing; 2,000-10,000 build
-- the pagination; past 10,000 the loyalty score has to be materialised first.

select b.shop_name,
       b.slug,
       count(distinct c.id) as customers,
       count(distinct o.id) as orders,
       case
         when count(distinct c.id) >= 100000 then 'rewrite territory'
         when count(distinct c.id) >=  10000 then 'materialise loyalty first'
         when count(distinct c.id) >=   2000 then 'BUILD PAGINATION'
         else 'fine'
       end as verdict
  from businesses b
  left join customers c on c.business_id = b.id
  left join orders    o on o.business_id = b.id
 group by b.id, b.shop_name, b.slug
 order by customers desc;
