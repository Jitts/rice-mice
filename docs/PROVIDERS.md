# Channel providers

Out of the box every channel runs in **manual mode**: the app composes the
message and opens WhatsApp / your mail app with it pre-filled — your click in
that app is the send. Nothing dispatches on its own and no API keys are needed.

Connecting a provider upgrades a channel to **direct mode**: the send buttons
in campaign runs and the action inbox deliver the message straight from the
app (one click, or "Send all remaining"). Every send is still an explicit
staff click — connecting a provider never makes anything automatic.

## Where keys live (since Sprint 27)

**Settings → Channel providers** is the home for every provider credential —
paste the key, tick Enabled, Save, then use the Test button to prove the
connection. No Vercel or Supabase visit needed.

How the storage is locked down:

- Keys live in the `channel_providers` table, which has row-level security
  enabled with **no policies** — the browser's database client (anon or
  signed-in) cannot read it at all, not even masked values.
- The Settings page shows only a masked fingerprint (`re_a…9fQx`); the full
  value never returns to any browser.
- Saving and testing run through server actions that first verify your role
  includes the **Channel providers** permission.
- The Test button sends a fixed test message — it can't be used to compose
  arbitrary content.

## Email — Resend (supported now)

1. Create a free account at https://resend.com.
2. **Verify your sending domain** (Resend → Domains → Add domain, then add the
   DNS records they show you). Until you do this, Resend only delivers to the
   email address you signed up with — fine for a first test.
3. Create an API key (Resend → API Keys).
4. In **Settings → Channel providers → Resend**: paste the API key, optionally
   set the From address (e.g. `Rice Mice <hello@yourdomain.co.za>`), tick
   Enabled, Save, then "Send test" to your own inbox.

(Legacy fallback: a `RESEND_API_KEY` / `RESEND_FROM` pair in Vercel env still
works when no key is saved in Settings — the Settings row wins when both exist.)

The app detects the key at page render: email campaign runs and email drafts
in the action inbox switch from "Open & mark sent" to "Send email" /
"Send all remaining". Disable the provider and it falls back to manual mode.

What direct mode does and doesn't change:

- The message sent is the exact logged draft (personalised body + unsubscribe
  footer) — what you approved is what goes out.
- Consent is re-checked server-side at the moment of sending; a customer who
  unsubscribed after the campaign was approved cannot be emailed.
- `engagement_logs.sent_via` records `manual` vs `resend` for every send.

## WhatsApp — Business Cloud API (keys ready, campaign wiring next)

You need a Meta developer account with WhatsApp added to an app
(https://developers.facebook.com/docs/whatsapp/cloud-api/get-started). From
the API Setup page take the **access token** and **phone number ID** into
Settings → Channel providers. The Test button sends Meta's built-in
`hello_world` template to a number you choose.

Honest constraint: WhatsApp only allows free-form messages inside the 24-hour
window after a customer last messaged you; marketing blasts require
**Meta-approved message templates**. The send adapter
(`lib/providers.ts` → `buildWhatsAppTextPayload` / `buildWhatsAppTemplatePayload`)
is built and tested; wiring it into campaign runs happens once a real account
with an approved template exists, because the template name is part of the send.

## SMS — Twilio (keys ready, campaign wiring next)

Account SID, auth token and a Twilio phone number from
https://console.twilio.com go into Settings → Channel providers. The Test
button sends a real SMS to a number you choose. Campaign-run wiring follows
the same pattern as email once you have an account.

## Telegram / LINE (config-only for now)

Both tokens can be stored and verified today (the Test button calls the
provider's identity endpoint — Telegram `getMe`, LINE `bot/info`). Actually
messaging customers needs a per-customer chat id (Telegram) or user id (LINE),
which those platforms only reveal after the customer messages your bot /
adds your official account — capturing those ids is a future sprint.
