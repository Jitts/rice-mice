-- Sprint 40: WhatsApp campaign sending via the Cloud API. sent_via's check
-- (0020) allowed 'manual' | 'resend' | 'twilio'; a direct WhatsApp send needs
-- its own value, distinct from 'manual' (which manual wa.me deep-link sends
-- already use). Looked up by column rather than a guessed constraint name,
-- since 0009 added it unnamed (Postgres auto-names it) and 0020 recreated it
-- under a fixed name — this stays robust either way.
do $$
declare cname text;
begin
  select con.conname into cname
  from pg_constraint con
  join pg_attribute att on att.attnum = any(con.conkey) and att.attrelid = con.conrelid
  where con.conrelid = 'engagement_logs'::regclass
    and con.contype = 'c'
    and att.attname = 'sent_via';
  if cname is not null then
    execute format('alter table engagement_logs drop constraint %I', cname);
  end if;
end $$;
alter table engagement_logs
  add constraint engagement_logs_sent_via_check
  check (sent_via in ('manual', 'resend', 'twilio', 'whatsapp'));
