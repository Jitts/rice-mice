# Tasks & Sprints

## Gantt Overview
```
Week 1  |-- Sprint 1: DB --|-- Sprint 2: Sign-up engine (v1 ✅) --|-- Sprint 3: Dashboard --|
Week 2  |-- Sprint 4: Lock it down --|-- Sprint 5: Loyalty & engagement --|
```

---

## Sprint 1 — Database Foundation
**Goal:** All tables exist, RLS is on, demo data is queryable.

- [ ] Apply migration SQL to Supabase project
- [ ] Confirm `customers`, `transactions`, `signup_events`, `engagement_logs` tables created
- [ ] Confirm 4 demo customers + 5 transactions + 4 signup_events seeded
- [ ] Confirm open v1 RLS policies active on all tables
- [ ] Screenshot Supabase table editor showing seed rows

**Definition of Done:** Running `select * from customers` in Supabase SQL editor returns 4 rows with no errors.

---

## Sprint 2 — Customer Sign-Up Engine ✅ v1 functional milestone
**Goal:** A real person can sign up; their data hits the database; WhatsApp opens.

- [ ] Homepage (`/`) renders sign-up form with fields: first_name, last_name, phone, email, whatsapp_opt_in
- [ ] Submit button inserts into `customers` + `signup_events` via Supabase client
- [ ] Loading spinner shown during insert
- [ ] Success state: "You're in! Check WhatsApp." message shown
- [ ] Error state: "Something went wrong — please try again." shown on Supabase error
- [ ] Empty/invalid form: inline validation before submit (phone required)
- [ ] If `whatsapp_opt_in = true`: open `wa.me/BUSINESS_PHONE?text=Hi+rice-mice!` in new tab
- [ ] Verify new row in Supabase `customers` table after test submission

**Definition of Done:** Fill in the form, click Submit, see success message, open Supabase — row exists with correct phone and `whatsapp_opt_in` value.

---

## Sprint 3 — Business Dashboard
**Goal:** Staff can see sign-ups and log transactions without logging in (demo mode).

- [ ] `/dashboard` page: sign-ups table (name, phone, opt-in, signed-up date)
- [ ] `/dashboard` page: transactions table (customer name, item, amount, date, staff)
- [ ] Empty state: "No sign-ups yet. Share your QR code!" when table is empty
- [ ] Loading skeleton on both tables
- [ ] "Add Transaction" form: select customer, item description, amount, payment method → inserts to `transactions`
- [ ] New transaction appears in table without page reload
- [ ] Verify adding a transaction reflects in the Supabase `transactions` table

**Definition of Done:** From `/dashboard`, add a transaction for a demo customer → it appears in the table immediately and persists on page refresh.

---

## Sprint 4 — Lock It Down (Auth + RLS)
**Goal:** Dashboard is gated behind staff login; public form stays open.

- [ ] Enable Supabase Auth; create one staff account via Supabase dashboard
- [ ] `/dashboard` redirects unauthenticated visitors to `/login`
- [ ] Login page: email + password → Supabase Auth session
- [ ] Replace v1 open RLS policies with `auth.uid() = user_id` owner-scoped policies
- [ ] Public sign-up form at `/` remains accessible without login
- [ ] Confirm no Supabase `service_role` key in any client-side bundle (check Network tab)
- [ ] Test: logged-out user cannot read `customers` rows via Supabase JS client

**Definition of Done:** Visiting `/dashboard` while logged out redirects to `/login`. After login, dashboard loads. Supabase query from browser console without session returns zero rows.

---

## Sprint 5 — Loyalty Scoring & At-Risk Flagging
**Goal:** Staff can see which customers are engaged and who needs re-engaging.

- [ ] `loyalty_score` computed in dashboard query: `(tx_count * 1) + floor(total_spend / 10000)`
- [ ] Score displayed on each customer row
- [ ] "At Risk" badge shown for customers with `last_purchase_date < now() - 30 days`
- [ ] Dashboard sort: highest loyalty score first
- [ ] `last_purchase_date` updated on each new transaction insert
- [ ] Verify At Risk badge appears for Sipho Dlamini (seeded 40 days ago)

**Definition of Done:** Dashboard shows at least one "At Risk" badge on seed data, loyalty scores are non-zero for customers with transactions, and scores update after a new transaction is added.
