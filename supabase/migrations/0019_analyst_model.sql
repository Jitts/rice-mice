-- 0019_analyst_model.sql
-- Version A of "bring your model": the platform holds ONE provider key (in the
-- server environment); each business chooses which model the read-only analyst
-- runs on from a curated, vetted list. What we store here is only a model id —
-- never a key or any secret. Null means "use the active provider's default",
-- resolved in lib/analystModel.ts, so existing rows need no backfill.
--
-- No new policy: businesses already carries uniform member-scoped RLS from
-- 0017, and a model id is non-sensitive, so the same member UPDATE path that
-- saves shop name / marketing rules saves this too. The UI gates it behind the
-- settings_business permission.

alter table businesses add column if not exists analyst_model text;

comment on column businesses.analyst_model is
  'Curated model id for the read-only analyst (see lib/analystModel.ts). Null = active provider default. Not a secret.';
