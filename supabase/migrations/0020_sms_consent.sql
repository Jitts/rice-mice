-- Sprint 39: SMS as a real send channel (Twilio). Consent is tracked
-- separately per channel (mirrors email_opt_in beside whatsapp_opt_in) — a
-- customer can opt into SMS without opting into WhatsApp or email marketing.
alter table customers
  add column if not exists sms_opt_in boolean not null default false;

-- sent_via's check (0009) only allowed 'manual' | 'resend'; a direct Twilio
-- send needs its own value. Looked up by column rather than a guessed
-- constraint name, since 0009 added it unnamed (Postgres auto-names it).
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
  add constraint engagement_logs_sent_via_check check (sent_via in ('manual', 'resend', 'twilio'));
