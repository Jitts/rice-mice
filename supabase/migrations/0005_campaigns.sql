-- Sprint 9 Pass B: campaigns — a bulk send run to a segment.
-- engagement_logs (planned for exactly this in docs/DATA_MODEL.md) becomes the
-- per-recipient message log; each campaign snapshots the segment name/definition
-- and the composed message so later segment edits never rewrite send history.

create table if not exists campaigns (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text not null,
  segment_id uuid references segments(id) on delete set null,
  segment_name text not null,
  definition jsonb not null,
  channel text not null check (channel in ('whatsapp', 'email', 'sms', 'telegram', 'line')),
  subject text,
  body text not null,
  recipient_count integer not null default 0 check (recipient_count >= 0),
  created_by text,
  completed_at timestamptz
);

alter table campaigns enable row level security;
drop policy if exists "campaigns_staff_all" on campaigns;
create policy "campaigns_staff_all" on campaigns for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

create index if not exists campaigns_created_at_idx on campaigns (created_at desc);

-- Link per-recipient log rows to their campaign. engagement_logs RLS is already
-- staff-only (0002).
alter table engagement_logs
  add column if not exists campaign_id uuid references campaigns(id) on delete cascade;

create index if not exists engagement_logs_campaign_idx on engagement_logs (campaign_id);
