-- Prints docs/DATA_MODEL.md. Read-only, catalog only — no customer rows.
-- Run in the Supabase SQL editor, copy the `line` column, save over the doc.
-- Re-run whenever the schema changes; never hand-edit the doc.
-- ponytail: unnest(conkey) mis-pairs a MULTI-column FK, and functions aren't
-- listed. Neither exists/matters today; add ordinality and a pg_proc block if so.

with t as (
  select c.oid, c.relname n, c.relrowsecurity rls
    from pg_class c join pg_namespace s on s.oid = c.relnamespace
   where s.nspname = 'public' and c.relkind = 'r'
), a as (
  select a.attrelid r, a.attnum i, a.attname n, a.attnotnull nn,
         format_type(a.atttypid, a.atttypmod) ty,
         pg_get_expr(d.adbin, d.adrelid) df
    from pg_attribute a
    left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
   where a.attnum > 0 and not a.attisdropped
), k as (
  select conrelid r, unnest(conkey) i, contype ty, confdeltype del,
         (select relname from pg_class where oid = confrelid) ref
    from pg_constraint where contype in ('p','f')
)
select line from (
  select '' tb, 0 rk, 0 od, '# Data Model' line
  union all select '', 0, 1, ''
  union all select '', 0, 2,
    'Generated from the live schema by `scripts/schema-doc.sql` — do not hand-edit.'
  union all select '', 0, 3,
    'Design reasoning lives in DECISIONS.md and TASKS.md, not here.'
  union all select '', 0, 4, ''
  union all
  select t.n, 1, 0, format('## %s — %s%s', t.n,
           case when t.rls then 'RLS on' else '**RLS OFF**' end,
           case when exists (select 1 from a where a.r = t.oid and a.n = 'business_id')
                then ' · tenant-scoped via business_id' else '' end)
    from t
  union all select t.n, 2, 0, '' from t
  union all select t.n, 3, 0, '| Column | Type | Default | Notes |' from t
  union all select t.n, 4, 0, '|---|---|---|---|' from t
  union all
  select t.n, 5, a.i, format('| %s | %s | %s | %s |', a.n, a.ty, coalesce(a.df, ''),
           concat_ws(' · ',
             case when exists (select 1 from k
                                where k.r = t.oid and k.i = a.i and k.ty = 'p') then 'PK' end,
             (select '→ ' || k.ref || case k.del
                     when 'c' then ' on delete cascade'
                     when 'n' then ' on delete set null'
                     when 'r' then ' on delete restrict' else '' end
                from k where k.r = t.oid and k.i = a.i and k.ty = 'f' limit 1),
             case when a.nn then 'not null' end))
    from t join a on a.r = t.oid
  union all select t.n, 6, 0, '' from t
) q order by tb, rk, od;
