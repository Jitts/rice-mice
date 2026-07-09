# Test Plan

## Core Success Scenario
**Scenario:** New customer signs up via the front-end form and appears in the dashboard.

### Steps
1. Open the app homepage (`/`) — confirm sign-up form loads without login
2. Leave all fields blank → click Submit → confirm inline validation fires (phone required)
3. Fill in: First: "Zanele", Last: "Khumalo", Phone: "+27800000001", Email: "zanele@test.com", tick WhatsApp opt-in
4. Click Submit → confirm loading spinner appears
5. Confirm success message: "You're in! Check WhatsApp."
6. Confirm a new browser tab / WhatsApp opens with pre-filled message
7. Open Supabase SQL editor → run `select * from customers where phone = '+27800000001'` → confirm 1 row returned
8. Open `/dashboard` → confirm "Zanele Khumalo" appears in sign-ups table
9. Confirm `whatsapp_opt_in = true` displayed on her row

---

## Empty States
| Screen | Trigger | Expected |
|---|---|---|
| Dashboard sign-ups | No customers in DB | "No sign-ups yet. Share your QR code!" |
| Dashboard transactions | No transactions | "No transactions logged yet." |

## Error States
| Scenario | Expected |
|---|---|
| Supabase insert fails (network off) | "Something went wrong — please try again." shown; no success message |
| Phone field empty on submit | Inline error: "Phone number is required" |
| Duplicate phone (if unique constraint added) | "This number is already registered." |

## Loading States
| Screen | Expected |
|---|---|
| Dashboard tables | Skeleton rows visible while query resolves |
| Sign-up form submit | Button disabled + spinner for duration of insert |

## Post-Lock-Down Auth Tests
| Test | Expected |
|---|---|
| Visit `/dashboard` logged out | Redirect to `/login` |
| Query `customers` from browser console (no session) | Returns 0 rows |
| Login with valid staff credentials | Dashboard loads with full data |
| Login with wrong password | "Invalid credentials" error shown |
