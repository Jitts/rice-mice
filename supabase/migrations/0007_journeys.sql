-- Sprint 16: staff-designed journeys with human launch + automated follow-through.
-- A journey is authored in the designer (definition jsonb: entry rule + branching
-- step tree), LAUNCHED by a person for a bounded window or evergreen, and then
-- the tick enrolls qualifying customers and advances them through waits/branches.
-- Automated actions only PREPARE message drafts into the action inbox — sending
-- stays a human click, always.

create table if not exists journeys (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  name text not null,
  definition jsonb not null default '{"entry":{"type":"stage","stage":"at_risk"},"steps":[],"exitOnOrder":true}'::jsonb,
  status text not null default 'draft' check (status in ('draft', 'running', 'stopped')),
  launched_at timestamptz,
  run_until timestamptz, -- null while running = evergreen
  created_by text
);

alter table journeys enable row level security;
drop policy if exists "journeys_staff_all" on journeys;
create policy "journeys_staff_all" on journeys for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- One enrollment per customer per journey, ever — the dedupe that makes the
-- tick idempotent and safe to run from any device at any time.
create table if not exists journey_runs (
  id uuid primary key default gen_random_uuid(),
  journey_id uuid not null references journeys(id) on delete cascade,
  customer_id uuid not null references customers(id) on delete cascade,
  entered_at timestamptz not null default now(),
  position jsonb not null default '[]'::jsonb,
  due_at timestamptz,
  status text not null default 'active' check (status in ('active', 'completed', 'exited')),
  unique (journey_id, customer_id)
);

alter table journey_runs enable row level security;
drop policy if exists "journey_runs_staff_all" on journey_runs;
create policy "journey_runs_staff_all" on journey_runs for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

create index if not exists journey_runs_active_idx on journey_runs (journey_id, status);

-- The action inbox: work the automation prepared, waiting for a human.
create table if not exists journey_actions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  run_id uuid not null references journey_runs(id) on delete cascade,
  journey_id uuid not null references journeys(id) on delete cascade,
  customer_id uuid not null references customers(id) on delete cascade,
  kind text not null default 'message' check (kind in ('message')),
  payload jsonb not null,
  status text not null default 'pending' check (status in ('pending', 'done', 'skipped')),
  acted_at timestamptz,
  acted_by text
);

alter table journey_actions enable row level security;
drop policy if exists "journey_actions_staff_all" on journey_actions;
create policy "journey_actions_staff_all" on journey_actions for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

create index if not exists journey_actions_pending_idx on journey_actions (status, created_at desc);
