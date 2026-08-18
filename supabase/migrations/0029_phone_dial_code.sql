-- Sprint 56. The public capture form hard-coded a "+27" hint, so every shop on
-- the platform showed a South African prefix on its own front door. Null means
-- "no hint" — the field just reads Phone number, correct everywhere.
--
-- The RPC is the ONLY anon window into businesses, so the column has to travel
-- through it or the public page can never see it. Changing a function's return
-- type needs drop + create (Postgres refuses in place), and the drop takes the
-- grants with it — hence the re-grant.

alter table businesses
  add column if not exists phone_dial_code text
    check (phone_dial_code is null or phone_dial_code ~ '^\+[0-9]{1,4}$');

drop function if exists public_business_branding(text);

create function public_business_branding(p_slug text)
returns table (id uuid, slug text, shop_name text, shop_emoji text,
               tagline text, phone text, phone_dial_code text)
language sql stable security definer set search_path = public as $$
  select id, slug, shop_name, shop_emoji, tagline, phone, phone_dial_code
  from businesses where slug = p_slug
$$;

revoke all on function public_business_branding(text) from public;
grant execute on function public_business_branding(text) to anon, authenticated;
