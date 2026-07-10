-- Sprint 10: custom segment criteria + segment merge/exclude.
-- Merge/exclude needs no schema change — segments.definition already stores an
-- arbitrary jsonb AND/OR tree; a "segment_ref" node (referencing another saved
-- segment by id, include or exclude) is just a new shape within that same tree.
-- Custom criteria need a place to define staff-created fields and store values.

create table if not exists custom_fields (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  key text not null unique,
  label text not null,
  value_type text not null check (value_type in ('text', 'number', 'boolean', 'date')),
  sort_order integer not null default 0
);

alter table custom_fields enable row level security;
drop policy if exists "custom_fields_staff_all" on custom_fields;
create policy "custom_fields_staff_all" on custom_fields for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

alter table customers
  add column if not exists custom_fields jsonb not null default '{}'::jsonb;

create index if not exists customers_custom_fields_idx on customers using gin (custom_fields);
