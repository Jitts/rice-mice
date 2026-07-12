-- Sprint 19: integrate journeys into campaign measurement. A journey message
-- send is stamped with journey_id (alongside the existing campaign_id column
-- used by one-time campaigns), so the same attribution engine can compute
-- "came back" / "revenue after send" scoped to a journey, not just a campaign.

alter table engagement_logs
  add column if not exists journey_id uuid references journeys(id) on delete set null;

create index if not exists engagement_logs_journey_idx on engagement_logs (journey_id)
  where journey_id is not null;
