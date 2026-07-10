-- Sprint 6: item catalog + multi-line orders with order numbers and status.
-- transactions stays in place (read by the legacy dashboard) until Sprint 7 retires it.

create table if not exists items (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text not null,
  price_cents integer not null check (price_cents >= 0),
  category text,
  is_active boolean not null default true,
  sort_order integer not null default 0
);

alter table items enable row level security;
drop policy if exists "items_staff_all" on items;
create policy "items_staff_all" on items for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

create table if not exists orders (
  id uuid primary key default gen_random_uuid(),
  order_no bigint generated always as identity unique,
  created_at timestamptz not null default now(),
  customer_id uuid references customers(id),
  status text not null default 'open'
    check (status in ('open', 'preparing', 'ready', 'completed', 'cancelled')),
  payment_method text,
  staff_name text,
  total_cents integer not null default 0 check (total_cents >= 0)
);

alter table orders enable row level security;
drop policy if exists "orders_staff_all" on orders;
create policy "orders_staff_all" on orders for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

create index if not exists orders_status_idx on orders (status);
create index if not exists orders_created_at_idx on orders (created_at desc);

create table if not exists order_items (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  order_id uuid not null references orders(id) on delete cascade,
  item_id uuid references items(id),
  item_name text not null,
  unit_price_cents integer not null check (unit_price_cents >= 0),
  quantity integer not null default 1 check (quantity > 0)
);

alter table order_items enable row level security;
drop policy if exists "order_items_staff_all" on order_items;
create policy "order_items_staff_all" on order_items for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

create index if not exists order_items_order_id_idx on order_items (order_id);

-- Backfill: every legacy transaction becomes a completed single-line order,
-- reusing the transaction id as the order id so the backfill is idempotent.
insert into orders (id, customer_id, status, payment_method, staff_name, total_cents, created_at)
select t.id, t.customer_id, 'completed', t.payment_method, t.staff_name,
       coalesce(t.amount_cents, 0), t.created_at
from transactions t
on conflict (id) do nothing;

insert into order_items (order_id, item_name, unit_price_cents, quantity, created_at)
select t.id, coalesce(t.item_description, 'Item'), coalesce(t.amount_cents, 0), 1, t.created_at
from transactions t
where not exists (select 1 from order_items oi where oi.order_id = t.id);

-- Starter menu (editable/deactivatable in the items manager).
insert into items (id, name, price_cents, category, sort_order) values
  ('b1000000-0000-0000-0000-000000000001', 'Rice Bowl (Large)', 8500, 'Bowls', 1),
  ('b1000000-0000-0000-0000-000000000002', 'Rice Bowl (Small)', 6500, 'Bowls', 2),
  ('b1000000-0000-0000-0000-000000000003', 'Mice Curry Combo', 12000, 'Bowls', 3),
  ('b1000000-0000-0000-0000-000000000004', 'Miso Soup', 3500, 'Sides', 4),
  ('b1000000-0000-0000-0000-000000000005', 'Side Salad', 3000, 'Sides', 5),
  ('b1000000-0000-0000-0000-000000000006', 'Iced Tea', 2800, 'Drinks', 6),
  ('b1000000-0000-0000-0000-000000000007', 'Sparkling Water', 2500, 'Drinks', 7)
on conflict (id) do nothing;
