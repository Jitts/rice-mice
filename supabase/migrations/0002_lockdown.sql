-- Sprint 4: replace v1 open RLS with staff-only reads/writes.
-- Public sign-up form keeps unauthenticated INSERT on customers + signup_events
-- (it always writes user_id = null); everything else requires a staff session.

drop policy if exists "customers_v1_read" on customers;
drop policy if exists "customers_v1_write" on customers;
create policy "customers_public_insert" on customers for insert with check (true);
create policy "customers_staff_select" on customers for select using (auth.role() = 'authenticated');
create policy "customers_staff_update" on customers for update using (auth.role() = 'authenticated');
create policy "customers_staff_delete" on customers for delete using (auth.role() = 'authenticated');

drop policy if exists "signup_events_v1_read" on signup_events;
drop policy if exists "signup_events_v1_write" on signup_events;
create policy "signup_events_public_insert" on signup_events for insert with check (true);
create policy "signup_events_staff_select" on signup_events for select using (auth.role() = 'authenticated');
create policy "signup_events_staff_update" on signup_events for update using (auth.role() = 'authenticated');
create policy "signup_events_staff_delete" on signup_events for delete using (auth.role() = 'authenticated');

drop policy if exists "transactions_v1_read" on transactions;
drop policy if exists "transactions_v1_write" on transactions;
create policy "transactions_staff_all" on transactions for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

drop policy if exists "engagement_logs_v1_read" on engagement_logs;
drop policy if exists "engagement_logs_v1_write" on engagement_logs;
create policy "engagement_logs_staff_all" on engagement_logs for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
