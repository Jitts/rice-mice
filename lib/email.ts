// Pure plumbing for the Resend email provider. No secrets live here — the
// API key is read only inside app/actions/email.ts (server), so this module
// stays importable from client components and unit tests.

export const RESEND_ENDPOINT = "https://api.resend.com/emails";

// Resend's shared onboarding sender: works out of the box but only delivers
// to the Resend account owner's own inbox — fine for a first smoke test,
// replaced by RESEND_FROM once the user verifies their domain.
export const DEFAULT_FROM = "Rice Mice <onboarding@resend.dev>";

export const DEFAULT_SUBJECT = "A message from Rice Mice";

export type ResendPayload = {
  from: string;
  to: [string];
  subject: string;
  text: string;
};

// Loose on purpose: this is a sanity check against garbage addresses reaching
// the provider, not an RFC validator — Resend rejects anything it can't parse.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function buildResendPayload(input: {
  from?: string | null;
  to: string;
  subject?: string | null;
  text: string;
}): ResendPayload | { error: string } {
  const to = input.to.trim();
  if (!EMAIL_RE.test(to)) return { error: "Recipient email address looks invalid" };
  const text = input.text.trim();
  if (!text) return { error: "Message is empty" };
  return {
    from: input.from?.trim() || DEFAULT_FROM,
    to: [to],
    subject: input.subject?.trim() || DEFAULT_SUBJECT,
    text,
  };
}
