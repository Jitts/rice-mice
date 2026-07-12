// Currency symbol for every price the app shows (user-decided: $).
export const CURRENCY = "$";

export function formatCents(cents: number | null) {
  if (cents == null) return "-";
  return `${CURRENCY}${(cents / 100).toFixed(2)}`;
}
