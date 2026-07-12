-- Sprint 29: loyalty rewards & redemption. Owners define rewards (a points
-- cost + a discount benefit); staff redeem them for a customer on the order
-- pad, which discounts the order and spends points. Points are never stored as
-- a mutable balance — earned is derived from completed orders (unchanged from
-- Sprint 5), spent is derived from the reward stamp on non-cancelled orders,
-- so the balance can't drift out of sync.

create table if not exists rewards (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  points_cost int not null check (points_cost > 0),
  benefit_type text not null check (benefit_type in ('percent', 'amount')),
  benefit_value int not null check (benefit_value > 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table rewards enable row level security;

-- Any signed-in staff member can READ rewards (the order pad needs them to
-- offer redemptions); only holders of the Business-settings permission may
-- create/edit/delete them, enforced by the same security-definer function the
-- roles table uses.
drop policy if exists rewards_select on rewards;
create policy rewards_select on rewards for select to authenticated using (true);

drop policy if exists rewards_insert on rewards;
create policy rewards_insert on rewards for insert to authenticated
  with check (user_has_permission('settings_business'));

drop policy if exists rewards_update on rewards;
create policy rewards_update on rewards for update to authenticated
  using (user_has_permission('settings_business'))
  with check (user_has_permission('settings_business'));

drop policy if exists rewards_delete on rewards;
create policy rewards_delete on rewards for delete to authenticated
  using (user_has_permission('settings_business'));

-- The redemption stamp on an order. reward_points_spent is a snapshot of what
-- the reward cost at redemption time; a cancelled order's redemption stops
-- counting as spent (the derivation filters on status), which refunds the
-- points automatically. An order can carry a campaign offer OR a reward
-- discount, never both — one discount source per order.
alter table orders
  add column if not exists reward_id uuid references rewards(id) on delete set null,
  add column if not exists reward_points_spent int not null default 0
    check (reward_points_spent >= 0);

alter table orders drop constraint if exists orders_single_discount_source;
alter table orders add constraint orders_single_discount_source
  check (campaign_id is null or reward_id is null);

create index if not exists orders_reward_id_idx on orders (reward_id)
  where reward_id is not null;

-- A couple of starter rewards so the order pad has something to offer on day
-- one (editable/deletable like any other seeded row). Only seeded when the
-- table is empty, so re-running never duplicates them.
insert into rewards (name, description, points_cost, benefit_type, benefit_value)
select * from (values
  ('Free drink', 'A regular drink on the house', 20, 'amount', 2800),
  ('10% off', 'Ten percent off the whole order', 40, 'percent', 10)
) as seed(name, description, points_cost, benefit_type, benefit_value)
where not exists (select 1 from rewards);
