# Channel providers

Out of the box every channel runs in **manual mode**: the app composes the
message and opens WhatsApp / your mail app with it pre-filled — your click in
that app is the send. Nothing dispatches on its own and no API keys are needed.

Connecting a provider upgrades a channel to **direct mode**: the send buttons
in campaign runs and the action inbox deliver the message straight from the
app (one click, or "Send all remaining"). Every send is still an explicit
staff click — connecting a provider never makes anything automatic.

## Email — Resend (supported now)

1. Create a free account at https://resend.com.
2. **Verify your sending domain** (Resend → Domains → Add domain, then add the
   DNS records they show you). Until you do this, Resend only delivers to the
   email address you signed up with — fine for a first test.
3. Create an API key (Resend → API Keys).
4. In Vercel → the `rice-mice` project → Settings → Environment Variables, add:
   - `RESEND_API_KEY` — the key from step 3 (Production environment).
   - `RESEND_FROM` — your sender, e.g. `Rice Mice <hello@yourdomain.co.za>`.
     Optional; without it the app uses Resend's shared onboarding sender,
     which only delivers to your own inbox.
5. Redeploy (Vercel → Deployments → Redeploy, or push any commit).

The app detects the key at page render: email campaign runs and email drafts
in the action inbox switch from "Open & mark sent" to "Send email" /
"Send all remaining". Remove the env var and it falls back to manual mode.

What direct mode does and doesn't change:

- The message sent is the exact logged draft (personalised body + unsubscribe
  footer) — what you approved is what goes out.
- Consent is re-checked server-side at the moment of sending; a customer who
  unsubscribed after the campaign was approved cannot be emailed.
- `engagement_logs.sent_via` records `manual` vs `resend` for every send.

## WhatsApp / SMS / Telegram / LINE (not yet connected)

WhatsApp Business API needs a Meta business verification + registered phone
number; SMS needs a local SMS provider account; Telegram/LINE need a bot or
official account. The channel registry in `lib/campaigns.ts` and the server
send path in `app/actions/email.ts` are the two places a new provider plugs
into — no UI rework needed. Bring the account/keys and we wire it the same
way as Resend.
