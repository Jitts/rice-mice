-- Sprint 20: real email sending (Resend) behind an env gate.
-- sent_via records HOW a message left: a staff deep-link click ('manual')
-- or the provider API ('resend'). Legacy rows stay null (manual era).
alter table engagement_logs
  add column if not exists sent_via text
  check (sent_via in ('manual', 'resend'));
