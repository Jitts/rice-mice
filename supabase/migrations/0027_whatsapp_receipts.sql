-- Sprint 53: WhatsApp delivery + read receipts.
-- Design notes live in docs/TASKS.md, not here. Keep this short.

alter table engagement_logs
  add column if not exists provider_message_id text,
  add column if not exists delivered_at timestamptz,
  add column if not exists read_at timestamptz,
  add column if not exists failed_at timestamptz,
  add column if not exists failure_reason text;

-- Meta's wamid is globally unique, so this is both the webhook's lookup index
-- and what makes a replayed callback a no-op.
create unique index if not exists engagement_logs_provider_message_id_idx
  on engagement_logs (provider_message_id)
  where provider_message_id is not null;
