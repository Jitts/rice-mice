-- Sprint 32 fix: signup_events' public-insert policy checked "the referenced
-- customer belongs to the same business" with a customers subquery — which
-- runs under the CALLER's RLS. Anon can't SELECT customers, so every public
-- sign-up event was rejected (42501). A SECURITY DEFINER helper performs the
-- integrity check without widening anon's read surface.

create or replace function customer_in_business(p_customer uuid, p_business uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from customers where id = p_customer and business_id = p_business
  )
$$;
revoke all on function customer_in_business(uuid, uuid) from public;
grant execute on function customer_in_business(uuid, uuid) to anon, authenticated;

drop policy if exists signup_events_public_insert on signup_events;
create policy signup_events_public_insert on signup_events for insert
  to anon, authenticated with check (
    business_id is not null
    and customer_in_business(customer_id, business_id)
  );
