const FALLBACK_PHONE = process.env.NEXT_PUBLIC_WHATSAPP_NUMBER || "27800000000";

// The public sign-up page's welcome deep-link. Each shop's own phone (from its
// business row) wins; the env number is a last-resort fallback.
export function buildWhatsAppLink(
  firstName: string,
  shopName = "rice-mice",
  phone?: string | null,
) {
  const digits = (phone ?? "").replace(/\D/g, "") || FALLBACK_PHONE;
  const message = `Hi ${shopName}! I'm ${firstName}, just signed up 🍚`;
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}
