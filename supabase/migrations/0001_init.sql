create table if not exists customers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  created_at timestamptz not null default now(),
  first_name text not null,
  last_name text not null,
  phone text,
  email text,
  whatsapp_opt_in boolean default false,
  loyalty_score numeric default 0,
  last_purchase_date timestamptz,
  last_contacted_at timestamptz,
  notes text
);

alter table customers enable row level security;
drop policy if exists "customers_v1_read" on customers;
create policy "customers_v1_read" on customers for select using (true);
drop policy if exists "customers_v1_write" on customers;
create policy "customers_v1_write" on customers for all using (true) with check (true);

create table if not exists transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  created_at timestamptz not null default now(),
  customer_id uuid references customers(id),
  item_description text,
  amount_cents integer,
  payment_method text,
  staff_name text
);

alter table transactions enable row level security;
drop policy if exists "transactions_v1_read" on transactions;
create policy "transactions_v1_read" on transactions for select using (true);
drop policy if exists "transactions_v1_write" on transactions;
create policy "transactions_v1_write" on transactions for all using (true) with check (true);

create table if not exists signup_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  created_at timestamptz not null default now(),
  customer_id uuid references customers(id),
  source text,
  whatsapp_link_opened boolean default false,
  referral_code text
);

alter table signup_events enable row level security;
drop policy if exists "signup_events_v1_read" on signup_events;
create policy "signup_events_v1_read" on signup_events for select using (true);
drop policy if exists "signup_events_v1_write" on signup_events;
create policy "signup_events_v1_write" on signup_events for all using (true) with check (true);

create table if not exists engagement_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  created_at timestamptz not null default now(),
  customer_id uuid references customers(id),
  channel text,
  message_draft text,
  message_draft_source text,
  message_draft_confidence numeric,
  message_draft_review_status text default 'unreviewed',
  sent_at timestamptz,
  sent_by text,
  outcome text
);

alter table engagement_logs enable row level security;
drop policy if exists "engagement_logs_v1_read" on engagement_logs;
create policy "engagement_logs_v1_read" on engagement_logs for select using (true);
drop policy if exists "engagement_logs_v1_write" on engagement_logs;
create policy "engagement_logs_v1_write" on engagement_logs for all using (true) with check (true);

insert into customers (id, first_name, last_name, phone, email, whatsapp_opt_in, loyalty_score, last_purchase_date) values
  ('a1000000-0000-0000-0000-000000000001', 'Amara', 'Osei', '+27821234567', 'amara@example.com', true, 42, now() - interval '5 days'),
  ('a1000000-0000-0000-0000-000000000002', 'Sipho', 'Dlamini', '+27839876543', 'sipho@example.com', true, 18, now() - interval '40 days'),
  ('a1000000-0000-0000-0000-000000000003', 'Lerato', 'Mokoena', '+27761112233', 'lerato@example.com', false, 7, now() - interval '12 days'),
  ('a1000000-0000-0000-0000-000000000004', 'Thandeka', 'Nkosi', '+27754445566', null, true, 31, now() - interval '2 days');

insert into transactions (customer_id, item_description, amount_cents, payment_method, staff_name) values
  ('a1000000-0000-0000-0000-000000000001', 'Rice Bowl (Large)', 8500, 'card', 'Naledi'),
  ('a1000000-0000-0000-0000-000000000001', 'Mice Curry Combo', 12000, 'cash', 'Naledi'),
  ('a1000000-0000-0000-0000-000000000002', 'Rice Bowl (Small)', 6500, 'card', 'Thabo'),
  ('a1000000-0000-0000-0000-000000000003', 'Drink + Side', 4000, 'card', 'Naledi'),
  ('a1000000-0000-0000-0000-000000000004', 'Mice Curry Combo', 12000, 'cash', 'Thabo');

insert into signup_events (customer_id, source, whatsapp_link_opened) values
  ('a1000000-0000-0000-0000-000000000001', 'in-store QR', true),
  ('a1000000-0000-0000-0000-000000000002', 'instagram link', true),
  ('a1000000-0000-0000-0000-000000000003', 'in-store QR', false),
  ('a1000000-0000-0000-0000-000000000004', 'word of mouth', true);