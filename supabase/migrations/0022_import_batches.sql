-- Sprint 45: customer CSV import. A bulk import is the one write in this app
-- that can create hundreds of rows from a single click, so it gets a receipt:
-- every row it creates carries its batch id. That makes "what did that import
-- actually do" answerable after the fact, and makes an undo possible later
-- without guessing at created_at timestamps.
--
-- kind is 'customers' | 'orders' so Sprint 46's order-history import reuses
-- this table instead of adding a second one.

create table if not exists import_batches (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  business_id uuid not null default current_business_id()
    references businesses(id) on delete cascade,
  kind text not null check (kind in ('customers', 'orders')),
  filename text not null,
  row_count integer not null default 0 check (row_count >= 0),
  created_count integer not null default 0 check (created_count >= 0),
  updated_count integer not null default 0 check (updated_count >= 0),
  skipped_count integer not null default 0 check (skipped_count >= 0),
  created_by text
);

alter table import_batches enable row level security;

create index if not exists import_batches_business_idx
  on import_batches (business_id, created_at desc);

drop policy if exists import_batches_member_all on import_batches;
create policy import_batches_member_all on import_batches for all to authenticated
  using (business_id in (select my_business_ids()))
  with check (business_id in (select my_business_ids()));

-- Which import created this customer. NULL is the normal path (signed up in
-- app), so this stays a marker for imported rows rather than a required link.
alter table customers
  add column if not exists import_batch_id uuid
    references import_batches(id) on delete set null;

create index if not exists customers_import_batch_idx
  on customers (import_batch_id) where import_batch_id is not null;
