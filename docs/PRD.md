# rice-mice — Product Requirements

## Problem
Small food businesses lose customers after the first purchase because there is no easy way to capture contact details at the point of sale and follow up. WhatsApp is the dominant communication channel, but sign-up data sits in paper notebooks or nowhere.

## Target Users
- **Customer (front-end):** walks in or scans a QR, fills in their details in seconds
- **Business owner / staff (dashboard):** sees who signed up, what they bought, and who needs re-engaging

## Core Objects
| Object | Purpose |
|---|---|
| Customer | Contact record: name, phone, email, WhatsApp opt-in |
| Transaction | One sale event linked to a customer |
| Signup Event | Records how/when a customer registered |
| Engagement Log | Tracks outreach attempts and outcomes |

## MVP Must-Haves (v1)
- [ ] Public sign-up form (no login) captures: first name, last name, phone, email, WhatsApp opt-in
- [ ] Submission writes a Customer row + Signup Event row to Supabase
- [ ] On WhatsApp opt-in, a `wa.me` deep-link opens with a pre-filled welcome message
- [ ] /dashboard lists all sign-ups and transactions (demo data visible immediately)
- [ ] Staff can log a new transaction against a customer
- [ ] All states handled: loading, empty, error, success

## Non-Goals (v1)
- No auth / login wall on sign-up form
- No automated message sending (WhatsApp Business API)
- No loyalty points redemption
- No multi-location or multi-tenant setup

## Success Criteria
> A customer scans a QR code → fills in the sign-up form → clicks Submit → their name appears in the /dashboard sign-ups list within 5 seconds, and if they ticked WhatsApp opt-in, a WhatsApp chat opens with a welcome message pre-filled.
