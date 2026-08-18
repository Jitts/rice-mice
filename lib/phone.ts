import { dialPrefixOf } from "@/lib/countries";

// Sprint 57. Turning "what the customer typed" + "which country they picked"
// into one stored number.
//
// This exists because 81 of 238 existing customers had local 8-digit numbers
// with no country code. lib/providers.ts:normalizePhone accepts 8 digits, so
// they passed validation and looked fine on every screen — but WhatsApp's Cloud
// API needs the full international number, so those sends could never land.
// Nothing in the product said so. The picker stops new sign-ups joining them.

/**
 * The number to store, in `+<code><subscriber>` form.
 *
 * Deliberately conservative about when it does NOT prepend the code:
 *  - a leading "+" or "00" means the customer typed an international number
 *    themselves, so their intent wins over the picker
 *  - digits that already open with the selected code, leaving a plausible
 *    subscriber number behind, are a paste of the full number
 * Anything else gets the code prepended, which is the common case: someone
 * typing their number the way they'd say it out loud.
 *
 * Returns null when there is nothing usable, so a caller can't store "+65".
 */
export function composePhone(dial: string | null, typed: string): string | null {
  const code = (dial ?? "").replace(/[^0-9]/g, "");
  const raw = typed.trim();
  const digits = raw.replace(/[^0-9]/g, "");
  if (!digits) return null;

  // The customer said "international" explicitly. Believe them over the picker.
  if (raw.startsWith("+")) return `+${digits}`;
  if (digits.startsWith("00")) return `+${digits.slice(2)}`;

  if (!code) return `+${digits}`;

  // A pasted full number: opens with the country code and still leaves a
  // subscriber number of believable length behind it.
  if (digits.startsWith(code)) {
    const rest = digits.slice(code.length);
    if (rest.length >= 6 && rest.length <= 12) return `+${digits}`;
  }

  return `+${code}${digits}`;
}

/**
 * Whether a composed number could be a real international number. Mirrors the
 * 8–15 digit rule lib/providers.ts:normalizePhone already applies, so the form
 * cannot accept something the send path will later reject.
 */
export function isPlausibleInternational(composed: string | null): boolean {
  if (!composed) return false;
  return /^\+[0-9]{8,15}$/.test(composed);
}

/**
 * "+6591234567" → "+65 9123 4567", for showing the customer what will be saved.
 *
 * The split comes from the real dialling-code list, not a regex: "+6591234567"
 * is 65|91234567, but a greedy 1-4 digit match reads it as 6591|234567 and
 * shows the customer a number that isn't theirs.
 */
export function formatForDisplay(composed: string | null): string {
  if (!composed || !composed.startsWith("+")) return composed ?? "";
  const digits = composed.slice(1);
  const code = dialPrefixOf(digits);
  if (!code) return composed;
  const grouped = digits.slice(code.length).replace(/(.{4})/g, "$1 ").trim();
  return grouped ? `+${code} ${grouped}` : composed;
}
