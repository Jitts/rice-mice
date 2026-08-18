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
  // Sprint 56 (migration 0029). The dialling prefix hinted on this shop's
  // public sign-up form. Null = no hint, which is correct for every shop that
  // hasn't set one — better than the "+27" that used to be hard-coded for all.
  phone_dial_code: string | null;
};

export const DEFAULT_BUSINESS: BusinessSettings = {
  shop_name: "rice-mice",
  shop_emoji: "🍚🐭",
  tagline: "Thanks for eating with us",
  phone: null,
  address: null,
  receipt_footer: "See you again! 🍚",
  phone_dial_code: null,
};

export function brandLine(b: BusinessSettings): string {
  return [b.shop_emoji, b.shop_name].filter(Boolean).join(" ").trim();
}

export function withBusinessDefaults(
  row: Partial<BusinessSettings> | null | undefined,
): BusinessSettings {
  return { ...DEFAULT_BUSINESS, ...(row ?? {}) };
}
