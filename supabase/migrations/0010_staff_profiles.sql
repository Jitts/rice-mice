-- Sprint 21: per-staff identity. One profile row per auth user; display_name
-- is what gets stamped on orders (staff_name) and sends (sent_by).
-- No role column yet — nothing enforces roles, and a flag nothing reads is a
-- lie waiting to happen; add it together with the first role-gated feature.

create table if not exists staff_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  display_name text not null
);

alter table staff_profiles enable row level security;

-- Every staff member can see the team list...
drop policy if exists "staff_profiles_select_all" on staff_profiles;
create policy "staff_profiles_select_all" on staff_profiles for select
  using (auth.role() = 'authenticated');

-- ...but can only create and edit their own profile.
drop policy if exists "staff_profiles_insert_own" on staff_profiles;
create policy "staff_profiles_insert_own" on staff_profiles for insert
  with check (auth.uid() = id);

drop policy if exists "staff_profiles_update_own" on staff_profiles;
create policy "staff_profiles_update_own" on staff_profiles for update
  using (auth.uid() = id) with check (auth.uid() = id);

-- Backfill: existing logins get a profile named after their email prefix.
insert into staff_profiles (id, display_name)
select id, initcap(split_part(email, '@', 1))
from auth.users
where email is not null
on conflict (id) do nothing;
