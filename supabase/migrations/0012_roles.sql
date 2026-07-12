-- Sprint 25: owner-defined roles. The permission catalog lives in code
-- (lib/permissions.ts) — a permission is only real if code enforces it —
-- and roles map a name to a set of catalog ids. '*' means every permission,
-- present and future (system Owner role only).
--
-- The escalation paths are enforced HERE, not just in the UI:
--   * only holders of the 'roles' permission can write the roles table
--   * only holders of 'team' can change anyone's role_id (incl. their own)
--   * the system Owner role can't be edited or deleted
--   * the last Owner can never be demoted
-- Trusted server contexts (service role / direct postgres) bypass the
-- permission check but still hit the last-Owner guard.

create table if not exists roles (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text not null unique,
  description text,
  permissions text[] not null default '{}',
  is_system boolean not null default false
);

alter table roles enable row level security;

alter table staff_profiles
  add column if not exists role_id uuid references roles(id) on delete set null;

-- Seed system + starter roles with fixed ids (idempotent).
insert into roles (id, name, description, permissions, is_system) values
  ('c0000000-0000-0000-0000-000000000001', 'Owner',
   'Full access to everything, including future features.', array['*'], true),
  ('c0000000-0000-0000-0000-000000000002', 'Staff',
   'Day-to-day counter and marketing work.',
   array['orders','menu','customers','segments','campaigns','reports'], false)
on conflict (id) do nothing;

-- Does the CURRENT caller hold a permission? Trusted server contexts
-- (service role, direct postgres) always pass; anon never does.
create or replace function user_has_permission(p text) returns boolean
language sql stable security definer set search_path = public as $$
  select
    coalesce(auth.role(), 'postgres') in ('service_role', 'postgres')
    or (
      auth.role() = 'authenticated'
      and exists (
        select 1
        from staff_profiles sp
        join roles r on r.id = sp.role_id
        where sp.id = auth.uid()
          and (r.permissions @> array['*']::text[]
               or r.permissions @> array[p]::text[])
      )
    );
$$;

grant execute on function user_has_permission(text) to authenticated, anon;

-- roles: readable by all staff, writable only with the 'roles' permission.
drop policy if exists "roles_select" on roles;
create policy "roles_select" on roles for select
  using (auth.role() = 'authenticated');
drop policy if exists "roles_insert" on roles;
create policy "roles_insert" on roles for insert
  with check (user_has_permission('roles'));
drop policy if exists "roles_update" on roles;
create policy "roles_update" on roles for update
  using (user_has_permission('roles')) with check (user_has_permission('roles'));
drop policy if exists "roles_delete" on roles;
create policy "roles_delete" on roles for delete
  using (user_has_permission('roles'));

-- System roles are immutable; roles with members can't be deleted.
create or replace function guard_roles() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    if old.is_system then
      raise exception 'System roles cannot be deleted';
    end if;
    if exists (select 1 from staff_profiles where role_id = old.id) then
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
  return new;
end $$;

drop trigger if exists roles_guard on roles;
create trigger roles_guard before update or delete on roles
  for each row execute function guard_roles();

-- Role assignment: 'team' permission required to change any role_id
-- (including your own — no self-promotion), a fresh INSERT can only carry
-- the default Staff role unless the inserter holds 'team', and the last
-- Owner can never be demoted (checked in every context, trusted or not).
create or replace function guard_role_assignment() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  owner_role constant uuid := 'c0000000-0000-0000-0000-000000000001';
  staff_role constant uuid := 'c0000000-0000-0000-0000-000000000002';
  remaining_owners int;
begin
  if tg_op = 'INSERT' then
    if new.role_id is not null and new.role_id <> staff_role
       and not user_has_permission('team') then
      new.role_id := staff_role;
    end if;
    return new;
  end if;
  if new.role_id is distinct from old.role_id then
    if not user_has_permission('team') then
      raise exception 'Changing roles requires the team permission';
    end if;
    if old.role_id = owner_role then
      select count(*) into remaining_owners
      from staff_profiles
      where role_id = owner_role and id <> old.id;
      if remaining_owners = 0 then
        raise exception 'At least one Owner must remain';
      end if;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists staff_profiles_role_guard on staff_profiles;
create trigger staff_profiles_role_guard before insert or update on staff_profiles
  for each row execute function guard_role_assignment();

-- Role assigners need to be able to update OTHER people's profiles too
-- (the update-own policy from 0010 only covers their own row).
drop policy if exists "staff_profiles_assign_roles" on staff_profiles;
create policy "staff_profiles_assign_roles" on staff_profiles for update
  using (user_has_permission('team')) with check (user_has_permission('team'));

-- Backfill (user decision 2026-07-12): every existing login becomes an Owner.
update staff_profiles
  set role_id = 'c0000000-0000-0000-0000-000000000001'
  where role_id is null;
