-- Sprint 24: business identity, editable in Settings. Deliberately non-secret —
-- the public sign-up page and printed receipts read it, so anon may SELECT.
-- Provider keys will NOT live here (they get a service-role-only table later).

create table if not exists business_settings (
  id boolean primary key default true check (id), -- singleton: only row = true
  updated_at timestamptz not null default now(),
  updated_by text,
  shop_name text not null default 'rice-mice',
  shop_emoji text not null default '🍚🐭',
  tagline text not null default 'Thanks for eating with us',
  phone text,
  address text,
  receipt_footer text not null default 'See you again! 🍚'
);

alter table business_settings enable row level security;

drop policy if exists "business_settings_public_read" on business_settings;
create policy "business_settings_public_read" on business_settings for select
  using (true);

drop policy if exists "business_settings_staff_update" on business_settings;
create policy "business_settings_staff_update" on business_settings for update
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- No insert/delete policies: the seeded singleton is the only row there will be.
insert into business_settings (id) values (true) on conflict (id) do nothing;
