// Business identity, stored as the business_settings singleton and editable
// in Settings. Every consumer falls back to these defaults, so a missing row
// (or the anon read failing) can never blank the UI.

export type BusinessSettings = {
  shop_name: string;
  shop_emoji: string;
  tagline: string;
  phone: string | null;
  address: string | null;
  receipt_footer: string;
};

export const DEFAULT_BUSINESS: BusinessSettings = {
  shop_name: "rice-mice",
  shop_emoji: "🍚🐭",
  tagline: "Thanks for eating with us",
  phone: null,
  address: null,
  receipt_footer: "See you again! 🍚",
};

export function brandLine(b: BusinessSettings): string {
  return [b.shop_emoji, b.shop_name].filter(Boolean).join(" ").trim();
}

export function withBusinessDefaults(
  row: Partial<BusinessSettings> | null | undefined,
): BusinessSettings {
  return { ...DEFAULT_BUSINESS, ...(row ?? {}) };
}
