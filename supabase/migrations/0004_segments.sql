-- Sprint 9: marketing segmentation (Pass A).
-- Adds saved segments, per-channel marketing consent + unsubscribe, and the
-- customer attributes (birthday, tags) the segment builder can filter on.
-- Sending campaigns is a later pass; nothing here dispatches a message.

-- --- Consent + new segmentable attributes on customers ------------------------
-- whatsapp_opt_in already exists (this is a WhatsApp-first business). Add an
-- email channel opt-in, a birthday, freeform tags, and a per-customer
-- unsubscribe token so a public one-click opt-out is possible without auth.
alter table customers
  add column if not exists email_opt_in boolean not null default false,
  add column if not exists birthday date,
  add column if not exists tags text[] not null default '{}',
  add column if not exists unsubscribe_token uuid not null default gen_random_uuid();

create index if not exists customers_tags_idx on customers using gin (tags);
create unique index if not exists customers_unsub_token_idx on customers (unsubscribe_token);

-- --- Saved segments -----------------------------------------------------------
-- A segment is a name + a serialised AND/OR criteria tree (the visual canvas
-- serialises straight to this jsonb). Counts are computed client-side from data
-- we already load, so there is no materialised membership to keep in sync.
create table if not exists segments (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  name text not null,
  definition jsonb not null default '{"type":"group","combinator":"all","children":[]}'::jsonb,
  is_starter boolean not null default false,
  created_by text
);

alter table segments enable row level security;
drop policy if exists "segments_staff_all" on segments;
create policy "segments_staff_all" on segments for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

create index if not exists segments_updated_at_idx on segments (updated_at desc);

-- --- Public unsubscribe -------------------------------------------------------
-- Anon cannot UPDATE customers (RLS). This security-definer function is the only
-- thing anon may call: it flips marketing consent off for exactly the row whose
-- token matches, and can neither read nor touch anything else.
create or replace function public.unsubscribe(p_token uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  hit integer;
begin
  update customers
     set whatsapp_opt_in = false,
         email_opt_in = false
   where unsubscribe_token = p_token;
  get diagnostics hit = row_count;
  return hit > 0;
end;
$$;

revoke all on function public.unsubscribe(uuid) from public;
grant execute on function public.unsubscribe(uuid) to anon, authenticated;

-- --- Starter segments (demo, editable/deletable in the manager) ----------------
insert into segments (id, name, definition, is_starter) values
  ('c2000000-0000-0000-0000-000000000001', 'Regulars',
   '{"type":"group","combinator":"all","children":[{"type":"condition","field":"order_count","op":"gte","value":3}]}'::jsonb, true),
  ('c2000000-0000-0000-0000-000000000002', 'Lapsing regulars',
   '{"type":"group","combinator":"all","children":[{"type":"condition","field":"order_count","op":"gte","value":3},{"type":"condition","field":"last_visit","op":"before_days","value":30}]}'::jsonb, true),
  ('c2000000-0000-0000-0000-000000000003', 'VIP spenders',
   '{"type":"group","combinator":"all","children":[{"type":"condition","field":"total_spent","op":"gte","value":50000}]}'::jsonb, true),
  ('c2000000-0000-0000-0000-000000000004', 'New this month',
   '{"type":"group","combinator":"all","children":[{"type":"condition","field":"signed_up","op":"within_days","value":30}]}'::jsonb, true)
on conflict (id) do nothing;

-- Demo tags + email consent so the tag/email criteria aren't empty on first open.
update customers set tags = '{VIP}', email_opt_in = true
  where id = 'a1000000-0000-0000-0000-000000000001';
update customers set tags = '{Catering}'
  where id = 'a1000000-0000-0000-0000-000000000004';
