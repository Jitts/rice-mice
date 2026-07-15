import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SignupForm } from "@/components/SignupForm";
import { QrCode } from "@/components/QrCode";
import { buildDirectChatLink } from "@/lib/whatsapp";

export const dynamic = "force-dynamic";

type Branding = {
  id: string;
  slug: string;
  shop_name: string;
  shop_emoji: string;
  tagline: string;
  phone: string | null;
};

// A shop's public sign-up page — what its counter QR points at. Branding comes
// through the public_business_branding RPC (the only anon window into
// businesses), and every insert from the form carries this shop's business_id.
export default async function ShopSignupPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("public_business_branding", {
    p_slug: slug.toLowerCase(),
  });
  if (error) console.error("branding RPC failed:", error.message);
  const biz = (Array.isArray(data) ? data[0] : data) as Branding | undefined;
  if (!biz) notFound();

  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-8 gap-6">
      <div className="text-center space-y-1">
        <h1 className="text-4xl font-bold tracking-tight">
          {[biz.shop_emoji, biz.shop_name].filter(Boolean).join(" ").trim()}
        </h1>
        <p className="text-muted-foreground">
          Sign up in seconds — we&apos;ll keep you in the loop on WhatsApp.
        </p>
      </div>
      <SignupForm
        businessId={biz.id}
        shopName={biz.shop_name}
        waPhone={biz.phone}
      />

      {/* A shortcut for people who'd rather message than fill a form. This
          does NOT capture their number into customers — WhatsApp doesn't tell
          us who scanned. The form above is the only path that actually saves
          contact details today. */}
      {biz.phone && (
        <div className="text-center space-y-2">
          <p className="text-xs text-muted-foreground">
            Prefer WhatsApp? Scan to chat with us directly.
          </p>
          <div className="inline-block rounded-lg bg-white p-1.5">
            <QrCode value={buildDirectChatLink(biz.shop_name, biz.phone)} size={112} />
          </div>
        </div>
      )}

      <Link href="/dashboard" className="text-sm text-muted-foreground/70 underline">
        Staff dashboard →
      </Link>
    </main>
  );
}
