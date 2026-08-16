// Currency symbol for every price the app shows (user-decided: $).
export const CURRENCY = "$";

export function formatCents(cents: number | null) {
  if (cents == null) return "-";
  return `${CURRENCY}${(cents / 100).toFixed(2)}`;
}

// Moved up from lib/findings.ts (Sprint 51), which had the only copy of this.
// The import wizard was writing "1 receipts" / "1 customers" in four places
// because it didn't have it — the same class of bug Sprint 48's live run found
// three of, and tests can't see because they're strings.
export function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}
