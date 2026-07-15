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

// A direct "chat with us" deep-link for someone who scans straight to
// WhatsApp instead of filling the sign-up form — no name to reference yet,
// so the message is generic. Kept separate from buildWhatsAppLink, whose
// message refers to the name just captured by the form.
export function buildDirectChatLink(shopName = "rice-mice", phone?: string | null) {
  const digits = (phone ?? "").replace(/\D/g, "") || FALLBACK_PHONE;
  const message = `Hi ${shopName}! I'd like to know more.`;
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}
