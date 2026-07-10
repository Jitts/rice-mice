export function formatCents(cents: number | null) {
  if (cents == null) return "-";
  return `R${(cents / 100).toFixed(2)}`;
}
