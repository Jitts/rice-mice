# rice-mice

rice-mice is a lean CRM + POS MVP that captures new customer sign-ups via a WhatsApp-linked front-end form, stores transactional and contact data in Supabase, and gives business stakeholders a live dashboard to drive repeat engagement.

## ⚠️ READ THIS BEFORE WRITING ANY CODE
A complete, correct plan for this app is already committed in `/docs`. Do **not** start
from the project name, the summary above, or your own assumptions — those will lead you to
build the wrong thing (e.g. a marketing landing page). Open the plan and build from it:

- `docs/PRD.md`
- `docs/ARCHITECTURE.md`
- `docs/DATA_MODEL.md`
- `docs/INTELLIGENCE_LAYER.md`
- `docs/AGENTIC_LAYER.md`
- `docs/SECURITY.md`
- `docs/TASKS.md`
- `docs/TEST_PLAN.md`

## Build rules (binding — follow in order)
1. **Read first:** open `docs/PRD.md`, `docs/DATA_MODEL.md`, `docs/ARCHITECTURE.md`, and
   `docs/TASKS.md` before writing a single line.
2. **Confirm the plan** back to me in 2–3 lines (the core objects + the one main workflow) BEFORE coding.
3. **Build the ONE core engine/verb FIRST, working end-to-end.** Every app has a main action —
   create a proposal, run the quote/simulation, log a change and act on it. Build THAT against the
   real database in Sprint 1, then breadth. Then build straight through the sprints until the app
   actually WORKS end-to-end. Do NOT stop after auth + an empty or "Connected" status dashboard, and
   do NOT ship read-only screens of seeded data — **every button and form must persist to the
   database and the UI must reflect it. NO dead buttons. Seeded rows are demo placeholders the user
   can also create/edit/delete.** Commit + push after each sprint; pause for review only once a real
   person can actually perform the core job.
4. **Database-first, but don't stop at the database:** lay the data model + core CRUD first (the
   core must work with the AI switched off), then build the real screens that make it usable.
5. **This is the real working app** — real forms, lists, detail views, and the end-to-end flow from
   the PRD's success scenario. Do **NOT** build a marketing/landing page, a front-end-only demo, or
   a connection-status dashboard.
6. **Dashboard requires sign-in; capture stays public.** `/dashboard/*` is gated behind Supabase Auth
   (middleware redirects to `/login` — see `lib/supabase/middleware.ts`), with per-shop membership and
   roles. The customer-facing signup/order-capture flow (`/`, `/s/[slug]`) stays public — that's the
   WhatsApp-linked front door and must never require login.
7. Never put secrets in frontend code.

## Deploy & data (binding — this stack is already provisioned)
- **Deploy by git, never by CLI.** `git add -A && git commit -m "…" && git push` to `main`;
  Vercel auto-deploys from GitHub. Do NOT run `vercel deploy` / `vercel --prod` with local
  files — it desyncs git, and the next push silently overwrites your live app.
- **Commit + push every change.** Git is the source of truth; uncommitted work is lost on
  the next deploy.
- **The Supabase database is already provisioned** and its keys are in this project's Vercel
  env. Pull them locally: `vercel link` then `vercel env pull .env.local`. Don't invent new ones.
- **Your database is already set up.** The schema from your data model has been applied to
  this project's Supabase database and committed at `supabase/migrations/0001_init.sql`. Build on
  the existing tables — **do not recreate them**. To change the schema, add a NEW migration file
  (`supabase/migrations/0002_*.sql`) and apply it; never edit `0001`.
- **Commit as your GitHub identity, or Vercel will block the deploy.** Vercel verifies that
  every commit's author email belongs to your GitHub account. Your machine's default git email
  often isn't, so the very first local commit gets rejected. Pin this repo's identity once
  (already correct for your account) — before your first commit:
  ```
  git config user.email "36510080+Jitts@users.noreply.github.com"
  git config user.name "Jitts"
  ```

Kickoff prompt: "Read everything in /docs, confirm the plan in 3 lines, then build straight
through the sprints until the app actually works end-to-end — the PRD's success scenario, not
just auth + an empty dashboard. The schema is already applied, so pull env with vercel env pull
and build on the existing tables; commit + push after each sprint to deploy. Stop only when a
real user can do the core job."

## Design Context
Design register and principles are captured in `PRODUCT.md`; run `/impeccable` for design commands.
- Register: product · Platform: web · Accessibility: WCAG AA
- Two surfaces, two tempos: customer sign-up/order = warm, fast, operational; owner dashboard = calm, advisory, comfortable
- Principles: two audiences two tempos · capture at the counter · calm intelligence · warmth of the shop not the vendor
- Avoid: cold POS terminal, generic AI SaaS templates, anxious/alarm-heavy dashboard
- Visual system: shadcn warm-orange/stone (no root DESIGN.md yet — run `/impeccable document`)
