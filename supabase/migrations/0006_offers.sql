-- Sprint 14: offers + redemption. A campaign can carry an optional offer
-- (percent or fixed amount, with a code); redeeming the code on the order pad
-- discounts the order and stamps which campaign it came from — exact
-- attribution, not just the time-window correlation.

alter table campaigns
  add column if not exists offer_code text,
  add column if not exists offer_type text check (offer_type in ('percent', 'amount')),
  add column if not exists offer_value integer check (offer_value > 0);

-- One live code per campaign, case-insensitive.
create unique index if not exists campaigns_offer_code_idx
  on campaigns (upper(offer_code)) where offer_code is not null;

-- orders.total_cents stays the FINAL charged amount; discount_cents records
-- what was taken off, and campaign_id is the exact redemption link.
alter table orders
  add column if not exists campaign_id uuid references campaigns(id) on delete set null,
  add column if not exists discount_cents integer not null default 0 check (discount_cents >= 0);

create index if not exists orders_campaign_id_idx on orders (campaign_id)
  where campaign_id is not null;
