-- Sprint 27: channel provider credentials, managed in Settings → Channel
-- providers. One row per provider; the provider-specific fields (API keys,
-- tokens, sender ids) live in config jsonb.
--
-- SECURITY MODEL — read before adding policies:
-- RLS is ENABLED and there are deliberately NO policies. That means the anon
-- and authenticated roles can neither read nor write this table through the
-- API: provider secrets never transit the browser's Supabase client, not even
-- masked. The ONLY access path is the server's service-role client
-- (lib/supabase/admin.ts), used by server actions that have already verified
-- the caller's 'providers' permission and that return masked values only.

create table if not exists channel_providers (
  id text primary key
    check (id in ('resend', 'whatsapp', 'twilio_sms', 'telegram', 'line')),
  enabled boolean not null default false,
  config jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by text
);

alter table channel_providers enable row level security;

-- Seed the five known providers so the Settings page always has a row to
-- update (no insert-or-update branching in the app).
insert into channel_providers (id) values
  ('resend'), ('whatsapp'), ('twilio_sms'), ('telegram'), ('line')
on conflict (id) do nothing;
