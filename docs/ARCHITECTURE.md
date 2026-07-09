# Architecture

## Stack
- **Frontend:** Next.js (App Router) — hosted on Vercel
- **Database + Auth:** Supabase (Postgres, RLS, Auth added in lock-down sprint)
- **Messaging:** `wa.me` deep-links (v1); WhatsApp Business API (later)

## Build Sequence
| Phase | What ships |
|---|---|
| Now | DB tables → public sign-up form → dashboard with seed + live data |
| Next | Staff auth, transaction entry, loyalty score |
| Later | WhatsApp API, AI segment tags, re-engagement drafts |

## Core Action Flow — Customer Signs Up
1. Customer opens URL / scans QR → homepage loads sign-up form (no auth)
2. Customer fills form and submits
3. Next.js calls Supabase client → inserts row in `customers` + `signup_events`
4. If `whatsapp_opt_in = true` → browser opens `wa.me/+BUSINESSNUMBER?text=Hi+rice-mice...`
5. Dashboard at `/dashboard` queries `customers` + `signup_events` → renders new row
6. Staff sees customer; can log a transaction (insert into `transactions`)

## Layer Plan
1. **Data layer** (tables + constraints + RLS) — runs without any app code
2. **App logic** (form validation, Supabase inserts, dashboard queries) — runs without AI
3. **Smart features** (loyalty scoring, segment tags, re-engagement drafts) — layered on top later

The core sign-up and dashboard work if every AI feature is switched off.
