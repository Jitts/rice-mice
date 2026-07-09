const BUSINESS_PHONE = process.env.NEXT_PUBLIC_WHATSAPP_NUMBER || "27800000000";

export function buildWhatsAppLink(firstName: string) {
  const message = `Hi rice-mice! I'm ${firstName}, just signed up 🍚🐭`;
  return `https://wa.me/${BUSINESS_PHONE}?text=${encodeURIComponent(message)}`;
}
