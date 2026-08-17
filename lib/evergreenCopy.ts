// Sprint 55. A one-time campaign is written once and read once, so "this
// weekend" is true for everyone who gets it. A journey keeps enrolling people
// for as long as it runs, so the same sentence is a lie by the following
// Monday — and nothing in the product would ever say so.
//
// This is the check the AI agent was going to make. It stayed rules-based:
// the judgement is "does this sentence pin itself to a calendar moment", which
// is a vocabulary question, not a reasoning one. Deterministic, instant, free,
// and it cannot hallucinate a phrase that isn't in the body.
//
// ponytail: a phrase list, so it catches the common shapes and misses
// creative ones ("before the ang pow runs out"). Upgrade to an analyst call —
// the planner already has a model wired — if a real journey ships with dated
// copy this list didn't catch. Not before: a model round trip on every launch
// buys nothing while the list is still finding things.

const MONTHS =
  "january|february|march|april|may|june|july|august|september|october|november|december";
const DAYS = "monday|tuesday|wednesday|thursday|friday|saturday|sunday";

const PATTERNS: { re: RegExp; why: string }[] = [
  { re: new RegExp(`\\bthis (weekend|week|month|year|${DAYS})\\b`, "gi"), why: "names a specific week" },
  { re: new RegExp(`\\bnext (weekend|week|month|${DAYS})\\b`, "gi"), why: "names a specific week" },
  { re: /\b(today|tonight|tomorrow) only\b/gi, why: "names a specific day" },
  { re: /\btomorrow\b/gi, why: "names a specific day" },
  { re: new RegExp(`\\b(ends|end[s]? on|until|through|by) (${DAYS})\\b`, "gi"), why: "has a deadline" },
  { re: /\b(ends|expires|closes) (today|tonight|tomorrow|soon)\b/gi, why: "has a deadline" },
  { re: /\blast chance\b/gi, why: "has a deadline" },
  { re: /\blimited time\b/gi, why: "has a deadline" },
  { re: new RegExp(`\\b(${MONTHS})\\b`, "gi"), why: "names a month" },
  { re: /\b20\d{2}\b/g, why: "names a year" },
];

export type DatedPhrase = { phrase: string; why: string };

/**
 * Phrases in `body` that will stop being true while an evergreen journey is
 * still sending it. Deduplicated case-insensitively, first spelling kept.
 */
export function datedPhrases(body: string): DatedPhrase[] {
  const found = new Map<string, DatedPhrase>();
  for (const { re, why } of PATTERNS) {
    // Fresh lastIndex per call: these are module-level /g regexes, and a
    // leftover index from the previous body would skip the start of this one.
    re.lastIndex = 0;
    for (const m of body.matchAll(re)) {
      const phrase = m[0].trim();
      const key = phrase.toLowerCase();
      if (!found.has(key)) found.set(key, { phrase, why });
    }
  }
  return [...found.values()];
}

/** One line for a confirm dialog, or null when the copy is safely evergreen. */
export function evergreenWarning(bodies: string[]): string | null {
  const all = new Map<string, DatedPhrase>();
  for (const b of bodies)
    for (const d of datedPhrases(b)) if (!all.has(d.phrase.toLowerCase())) all.set(d.phrase.toLowerCase(), d);
  if (all.size === 0) return null;
  const list = [...all.values()].map((d) => `“${d.phrase}” (${d.why})`).join(", ");
  return (
    `This journey runs until you stop it, but the message ${list}. ` +
    `Everyone who qualifies next month gets the same words. ` +
    `Launch anyway, or set an end date / reword first?`
  );
}
