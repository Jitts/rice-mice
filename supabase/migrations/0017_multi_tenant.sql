-- Sprint 32: multi-tenancy. One codebase, one database; every row belongs to a
-- business and isolation is enforced in Postgres RLS, not app code. The
-- existing café becomes tenant #1 by backfill, so nothing live breaks.
--
-- Shape:
--   businesses   — the tenant. Absorbs business_settings (identity + marketing
--                  rules + loyalty config) and adds a public slug for the
--                  sign-up URL (/s/<slug>).
--   memberships  — who belongs to which business, with which role. v1 keeps
--                  ONE business per user (unique user_id) so that
--                  current_business_id() is unambiguous and inserts can carry
--                  business_id by column DEFAULT; drop that unique when
--                  multi-shop membership arrives.
--   roles        — become per-business; each shop gets its own Owner/Staff.
--   every domain table gains business_id (backfilled, NOT NULL, indexed,
--   DEFAULT current_business_id()) and one uniform RLS pattern.

-- ---------------------------------------------------------------- tenant #1 id
-- Fixed so the backfill is idempotent and referenceable.
-- d0000000-0000-0000-0000-000000000001, slug 'rice-mice'.

-- ------------------------------------------------------------------ businesses
create table if not exists businesses (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  slug text not null unique
    check (slug ~ '^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])?$'),
  updated_at timestamptz not null default now(),
  updated_by text,
  -- identity (from business_settings)
  shop_name text not null default 'My shop',
  shop_emoji text not null default '🍚',
  tagline text not null default 'Thanks for visiting',
  phone text,
  address text,
  receipt_footer text not null default 'See you again!',
  -- marketing rules (0014)
  attribution_window_days int not null default 14
    check (attribution_window_days between 1 and 365),
  at_risk_days int not null default 30
    check (at_risk_days between 1 and 365),
  churn_days int not null default 90
    check (churn_days between 2 and 730),
  loyal_min_orders int not null default 3
    check (loyal_min_orders between 1 and 100),
  constraint marketing_windows_ordered check (churn_days > at_risk_days),
  -- loyalty earning (0016)
  loyalty_points_per_order int not null default 1
    check (loyalty_points_per_order between 0 and 1000),
  loyalty_cents_per_point int not null default 10000
    check (loyalty_cents_per_point = 0
           or loyalty_cents_per_point between 100 and 100000000),
  loyalty_signup_bonus_points int not null default 0
    check (loyalty_signup_bonus_points between 0 and 1000),
  constraint loyalty_earning_possible check (
    loyalty_points_per_order > 0
    or loyalty_cents_per_point > 0
    or loyalty_signup_bonus_points > 0
  )
);

alter table businesses enable row level security;

-- Tenant #1: copy the singleton's values, then retire business_settings.
insert into businesses (
  id, slug, updated_at, updated_by, shop_name, shop_emoji, tagline, phone,
  address, receipt_footer, attribution_window_days, at_risk_days, churn_days,
  loyal_min_orders, loyalty_points_per_order, loyalty_cents_per_point,
  loyalty_signup_bonus_points
)
select
  'd0000000-0000-0000-0000-000000000001', 'rice-mice', updated_at, updated_by,
  shop_name, shop_emoji, tagline, phone, address, receipt_footer,
  attribution_window_days, at_risk_days, churn_days, loyal_min_orders,
  loyalty_points_per_order, loyalty_cents_per_point, loyalty_signup_bonus_points
from business_settings
where not exists (select 1 from businesses where id = 'd0000000-0000-0000-0000-000000000001');

drop table if exists business_settings;

-- ----------------------------------------------------------------- memberships
create table if not exists memberships (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  business_id uuid not null references businesses(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role_id uuid references roles(id) on delete set null,
  unique (business_id, user_id),
  -- v1: one shop per user, so current_business_id() is well-defined.
  unique (user_id)
);

alter table memberships enable row level security;
create index if not exists memberships_business_idx on memberships (business_id);

-- The caller's businesses. SECURITY DEFINER so RLS policies can use these
-- without recursing into memberships' own policies.
create or replace function my_business_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  select business_id from memberships where user_id = auth.uid()
$$;
grant execute on function my_business_ids() to authenticated, anon;

create or replace function current_business_id() returns uuid
language sql stable security definer set search_path = public as $$
  select business_id from memberships where user_id = auth.uid() limit 1
$$;
grant execute on function current_business_id() to authenticated, anon;

-- -------------------------------------------------------- roles → per business
alter table roles
  add column if not exists business_id uuid references businesses(id) on delete cascade;
update roles set business_id = 'd0000000-0000-0000-0000-000000000001'
  where business_id is null;
alter table roles alter column business_id set not null;
alter table roles drop constraint if exists roles_name_key;
alter table roles drop constraint if exists roles_name_per_business;
alter table roles add constraint roles_name_per_business unique (business_id, name);
-- The Roles manager creates roles from the client without a business_id.
alter table roles alter column business_id set default current_business_id();
create index if not exists roles_business_idx on roles (business_id);

-- Backfill memberships from the pre-tenant staff_profiles.role_id.
insert into memberships (business_id, user_id, role_id)
select 'd0000000-0000-0000-0000-000000000001', sp.id, sp.role_id
from staff_profiles sp
on conflict do nothing;

-- Retire the old role plumbing on staff_profiles (moved to memberships).
drop trigger if exists staff_profiles_role_guard on staff_profiles;
drop function if exists guard_role_assignment();
drop policy if exists "staff_profiles_assign_roles" on staff_profiles;
alter table staff_profiles drop column if exists role_id;

-- Permission check now reads memberships. Trusted server contexts still pass.
create or replace function user_has_permission(p text) returns boolean
language sql stable security definer set search_path = public as $$
  select
    coalesce(auth.role(), 'postgres') in ('service_role', 'postgres')
    or (
      auth.role() = 'authenticated'
      and exists (
        select 1
        from memberships m
        join roles r on r.id = m.role_id
        where m.user_id = auth.uid()
          and (r.permissions @> array['*']::text[]
               or r.permissions @> array[p]::text[])
      )
    );
$$;

-- Role integrity + escalation guards on memberships:
--  * a membership's role must belong to the same business
--  * changing roles needs the team permission (trusted contexts pass)
--  * the last Owner of a business can never be demoted or removed
--  * bootstrap: the FIRST membership of a business may be created without the
--    team permission (that's create_business seeding its owner; plain clients
--    can't INSERT memberships at all — there is no insert policy)
create or replace function guard_membership_roles() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  trusted boolean := coalesce(auth.role(), 'postgres') in ('service_role', 'postgres');
  is_owner_role boolean;
  remaining_owners int;
begin
  if tg_op = 'DELETE' then
    select r.is_system into is_owner_role from roles r where r.id = old.role_id;
    if coalesce(is_owner_role, false) then
      select count(*) into remaining_owners
      from memberships m join roles r on r.id = m.role_id
      where m.business_id = old.business_id and r.is_system and m.id <> old.id;
      if remaining_owners = 0 then
        raise exception 'At least one Owner must remain';
      end if;
    end if;
    return old;
  end if;

  if new.role_id is not null and not exists (
    select 1 from roles r where r.id = new.role_id and r.business_id = new.business_id
  ) then
    raise exception 'That role belongs to a different business';
  end if;

  if tg_op = 'INSERT' then
    if not trusted
       and exists (select 1 from memberships m where m.business_id = new.business_id)
       and not user_has_permission('team') then
      raise exception 'Adding members requires the team permission';
    end if;
    return new;
  end if;

  if new.business_id is distinct from old.business_id then
    raise exception 'Memberships cannot move between businesses';
  end if;

  if new.role_id is distinct from old.role_id then
    if not trusted and not user_has_permission('team') then
      raise exception 'Changing roles requires the team permission';
    end if;
    select r.is_system into is_owner_role from roles r where r.id = old.role_id;
    if coalesce(is_owner_role, false) then
      select count(*) into remaining_owners
      from memberships m join roles r on r.id = m.role_id
      where m.business_id = old.business_id and r.is_system and m.id <> old.id;
      if remaining_owners = 0 then
        raise exception 'At least one Owner must remain';
      end if;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists memberships_role_guard on memberships;
create trigger memberships_role_guard before insert or update or delete on memberships
  for each row execute function guard_membership_roles();

-- guard_roles referenced staff_profiles.role_id; rewrite over memberships.
create or replace function guard_roles() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    if old.is_system then
      raise exception 'System roles cannot be deleted';
    end if;
    if exists (select 1 from memberships where role_id = old.id) then
      raise exception 'Reassign this role''s members before deleting it';
    end if;
    return old;
  end if;
  if old.is_system then
    raise exception 'System roles cannot be edited';
  end if;
  if new.is_system and not old.is_system then
    raise exception 'A role cannot be promoted to a system role';
  end if;
  if new.business_id is distinct from old.business_id then
    raise exception 'Roles cannot move between businesses';
  end if;
  return new;
end $$;
-- (trigger roles_guard from 0012 still points at guard_roles — unchanged.)

-- ------------------------------------------- business_id on every domain table
do $$
declare t text;
begin
  foreach t in array array[
    'customers','signup_events','engagement_logs','items','orders',
    'order_items','segments','campaigns','custom_fields','journeys',
    'journey_runs','journey_actions','rewards'
  ] loop
    execute format('alter table %I add column if not exists business_id uuid references businesses(id) on delete cascade', t);
    execute format('update %I set business_id = ''d0000000-0000-0000-0000-000000000001'' where business_id is null', t);
    execute format('alter table %I alter column business_id set not null', t);
    execute format('alter table %I alter column business_id set default current_business_id()', t);
    execute format('create index if not exists %I on %I (business_id)', t || '_business_idx', t);
  end loop;
end $$;

-- Per-business uniques that were global before.
alter table custom_fields drop constraint if exists custom_fields_key_key;
alter table custom_fields drop constraint if exists custom_fields_key_per_business;
alter table custom_fields add constraint custom_fields_key_per_business unique (business_id, key);

drop index if exists campaigns_offer_code_idx;
create unique index if not exists campaigns_offer_code_idx
  on campaigns (business_id, upper(offer_code)) where offer_code is not null;

-- channel_providers: one row per provider PER BUSINESS. Still deliberately no
-- policies — service-role only, exactly as 0013 designed.
alter table channel_providers
  add column if not exists business_id uuid references businesses(id) on delete cascade;
update channel_providers set business_id = 'd0000000-0000-0000-0000-000000000001'
  where business_id is null;
alter table channel_providers alter column business_id set not null;
alter table channel_providers drop constraint if exists channel_providers_pkey;
alter table channel_providers add primary key (business_id, id);

-- transactions: dead since Sprint 7 (orders replaced it; zero app references).
drop table if exists transactions;

-- -------------------------------------------------------------------- audit log
-- The AGENTIC_LAYER spec's table, created now so team/provisioning actions can
-- start writing it (agents will require it). No client insert path: writes come
-- from security-definer functions and the server's service-role client only.
create table if not exists audit_log (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  business_id uuid not null references businesses(id) on delete cascade,
  actor text not null,
  action text not null,
  target_id text,
  payload_snapshot jsonb,
  outcome text not null default 'success'
);
alter table audit_log enable row level security;
create index if not exists audit_log_business_idx on audit_log (business_id, created_at desc);

-- ------------------------------------------------------------ rebuild policies
-- Drop every existing policy on the tenant tables, then recreate one uniform
-- business-scoped set. Dynamic drop = no dependence on historical policy names.
do $$
declare r record;
begin
  for r in
    select policyname, tablename from pg_policies
    where schemaname = 'public' and tablename in (
      'customers','signup_events','engagement_logs','items','orders',
      'order_items','segments','campaigns','custom_fields','journeys',
      'journey_runs','journey_actions','rewards','roles','staff_profiles',
      'memberships','businesses','audit_log'
    )
  loop
    execute format('drop policy %I on %I', r.policyname, r.tablename);
  end loop;
end $$;

-- Standard staff tables: full access within your business.
do $$
declare t text;
begin
  foreach t in array array[
    'engagement_logs','items','orders','order_items','segments','campaigns',
    'custom_fields','journeys','journey_runs','journey_actions'
  ] loop
    execute format(
      'create policy %I on %I for all to authenticated
         using (business_id in (select my_business_ids()))
         with check (business_id in (select my_business_ids()))',
      t || '_member_all', t);
  end loop;
end $$;

-- customers: the public sign-up form INSERTs without a session; everything
-- else is member-scoped. (A public insert into any business is the nature of
-- a public form — equivalent to submitting that shop's sign-up page.)
create policy customers_public_insert on customers for insert
  to anon, authenticated with check (business_id is not null);
create policy customers_member_select on customers for select
  to authenticated using (business_id in (select my_business_ids()));
create policy customers_member_update on customers for update
  to authenticated using (business_id in (select my_business_ids()))
  with check (business_id in (select my_business_ids()));
create policy customers_member_delete on customers for delete
  to authenticated using (business_id in (select my_business_ids()));

-- signup_events: public insert must reference a customer of the SAME business.
create policy signup_events_public_insert on signup_events for insert
  to anon, authenticated with check (
    business_id is not null
    and exists (select 1 from customers c
                where c.id = customer_id and c.business_id = signup_events.business_id)
  );
create policy signup_events_member_select on signup_events for select
  to authenticated using (business_id in (select my_business_ids()));
create policy signup_events_member_update on signup_events for update
  to authenticated using (business_id in (select my_business_ids()))
  with check (business_id in (select my_business_ids()));
create policy signup_events_member_delete on signup_events for delete
  to authenticated using (business_id in (select my_business_ids()));

-- rewards: members read; settings_business writes (as 0015 intended).
create policy rewards_member_select on rewards for select
  to authenticated using (business_id in (select my_business_ids()));
create policy rewards_admin_insert on rewards for insert
  to authenticated with check (
    business_id in (select my_business_ids()) and user_has_permission('settings_business'));
create policy rewards_admin_update on rewards for update
  to authenticated using (
    business_id in (select my_business_ids()) and user_has_permission('settings_business'))
  with check (
    business_id in (select my_business_ids()) and user_has_permission('settings_business'));
create policy rewards_admin_delete on rewards for delete
  to authenticated using (
    business_id in (select my_business_ids()) and user_has_permission('settings_business'));

-- roles: members read their business's roles; 'roles' permission writes.
create policy roles_member_select on roles for select
  to authenticated using (business_id in (select my_business_ids()));
create policy roles_admin_insert on roles for insert
  to authenticated with check (
    business_id in (select my_business_ids()) and user_has_permission('roles'));
create policy roles_admin_update on roles for update
  to authenticated using (
    business_id in (select my_business_ids()) and user_has_permission('roles'))
  with check (
    business_id in (select my_business_ids()) and user_has_permission('roles'));
create policy roles_admin_delete on roles for delete
  to authenticated using (
    business_id in (select my_business_ids()) and user_has_permission('roles'));

-- staff_profiles: you see yourself + people who share a business with you.
create policy staff_profiles_select on staff_profiles for select
  to authenticated using (
    id = auth.uid()
    or exists (select 1 from memberships m
               where m.user_id = staff_profiles.id
                 and m.business_id in (select my_business_ids())));
create policy staff_profiles_insert_own on staff_profiles for insert
  to authenticated with check (auth.uid() = id);
create policy staff_profiles_update_own on staff_profiles for update
  to authenticated using (auth.uid() = id) with check (auth.uid() = id);

-- memberships: members see their business's roster; role assignment needs the
-- team permission (guard trigger enforces the rest). No client INSERT/DELETE —
-- those run through create_business / the service-role team actions.
create policy memberships_member_select on memberships for select
  to authenticated using (business_id in (select my_business_ids()));
create policy memberships_team_update on memberships for update
  to authenticated using (
    business_id in (select my_business_ids()) and user_has_permission('team'))
  with check (
    business_id in (select my_business_ids()) and user_has_permission('team'));

-- businesses: members read/update their own; branding for the public sign-up
-- page flows through the RPC below, so there is no anon select (and no shop
-- enumeration).
create policy businesses_member_select on businesses for select
  to authenticated using (id in (select my_business_ids()));
create policy businesses_admin_update on businesses for update
  to authenticated using (
    id in (select my_business_ids()) and user_has_permission('settings_business'))
  with check (
    id in (select my_business_ids()) and user_has_permission('settings_business'));

-- audit_log: readable by team-permission holders of the business; no client writes.
create policy audit_log_team_select on audit_log for select
  to authenticated using (
    business_id in (select my_business_ids()) and user_has_permission('team'));

-- ------------------------------------------------------------------------ RPCs
-- Public branding for /s/<slug> — the only anon window into businesses, and it
-- returns exactly the fields the sign-up page renders.
create or replace function public_business_branding(p_slug text)
returns table (id uuid, slug text, shop_name text, shop_emoji text, tagline text, phone text)
language sql stable security definer set search_path = public as $$
  select id, slug, shop_name, shop_emoji, tagline, phone
  from businesses where slug = p_slug
$$;
revoke all on function public_business_branding(text) from public;
grant execute on function public_business_branding(text) to anon, authenticated;

-- Self-serve onboarding: creates the business, its Owner/Staff roles, the
-- caller's Owner membership, provider rows, and a starter menu + rewards.
create or replace function create_business(p_name text, p_slug text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  bid uuid;
  owner_role uuid;
  clean_slug text := lower(trim(p_slug));
  clean_name text := coalesce(nullif(trim(p_name), ''), 'My shop');
begin
  if auth.uid() is null then
    raise exception 'Sign in first';
  end if;
  if exists (select 1 from memberships where user_id = auth.uid()) then
    raise exception 'You already belong to a shop';
  end if;
  if clean_slug !~ '^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])?$' then
    raise exception 'Links can use lowercase letters, numbers and dashes (3-40 characters)';
  end if;
  if clean_slug in ('dashboard','login','signup','api','s','unsubscribe','new',
                    'admin','settings','www','app','assets','static') then
    raise exception 'That link is reserved — pick another';
  end if;
  if exists (select 1 from businesses where slug = clean_slug) then
    raise exception 'That link is taken — pick another';
  end if;

  insert into businesses (slug, shop_name) values (clean_slug, clean_name)
    returning businesses.id into bid;

  insert into roles (business_id, name, description, permissions, is_system) values
    (bid, 'Owner', 'Full access to everything, including future features.',
     array['*'], true)
    returning roles.id into owner_role;
  insert into roles (business_id, name, description, permissions) values
    (bid, 'Staff', 'Day-to-day counter and marketing work.',
     array['orders','menu','customers','segments','campaigns','reports']);

  insert into memberships (business_id, user_id, role_id)
    values (bid, auth.uid(), owner_role);

  insert into channel_providers (business_id, id)
    select bid, unnest(array['resend','whatsapp','twilio_sms','telegram','line']);

  -- Starter menu + rewards: useful defaults, all editable/deletable. No fake
  -- customers — a real shop starts with a real (empty) customer list.
  insert into items (business_id, name, price_cents, category, sort_order) values
    (bid, 'House Bowl (Large)', 8500, 'Bowls', 1),
    (bid, 'House Bowl (Small)', 6500, 'Bowls', 2),
    (bid, 'Daily Combo', 12000, 'Bowls', 3),
    (bid, 'Soup of the Day', 3500, 'Sides', 4),
    (bid, 'Side Salad', 3000, 'Sides', 5),
    (bid, 'Iced Tea', 2800, 'Drinks', 6),
    (bid, 'Sparkling Water', 2500, 'Drinks', 7);
  insert into rewards (business_id, name, description, points_cost, benefit_type, benefit_value) values
    (bid, 'Free drink', 'A regular drink on the house', 20, 'amount', 2800),
    (bid, '10% off', 'Ten percent off the whole order', 40, 'percent', 10);

  insert into audit_log (business_id, actor, action, target_id, payload_snapshot)
  values (
    bid,
    coalesce((select display_name from staff_profiles where staff_profiles.id = auth.uid()), 'owner'),
    'business.created', bid::text, jsonb_build_object('slug', clean_slug, 'name', clean_name)
  );

  return bid;
end $$;
revoke all on function create_business(text, text) from public;
grant execute on function create_business(text, text) to authenticated;
