-- Sprint 46: order history import.
--
-- import_ref is the idempotency key, and it is what makes re-running the same
-- export a no-op instead of doubling a café's revenue. It holds the POS's own
-- receipt/order id when the file has one; when it doesn't, the importer stores
-- a stable hash of (customer, timestamp, total, first item) prefixed 'auto:'
-- so a generated key can never be mistaken for a real receipt number.
--
-- Unique PER BUSINESS and only where set: existing orders (and every order
-- taken in the app) leave it NULL, and two shops may legitimately both have a
-- receipt "R-1044".

alter table orders
  add column if not exists import_ref text,
  add column if not exists import_batch_id uuid
    references import_batches(id) on delete set null;

create unique index if not exists orders_business_import_ref_key
  on orders (business_id, import_ref) where import_ref is not null;

create index if not exists orders_import_batch_idx
  on orders (import_batch_id) where import_batch_id is not null;
