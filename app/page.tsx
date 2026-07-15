import Link from "next/link";

// The product landing. Each shop's own sign-up page lives at /s/<slug> —
// that's what their counter QR points at.

export default function Home() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-8 gap-8">
      <div className="text-center space-y-2">
        <h1 className="text-4xl font-bold tracking-tight">🍚🐭 rice-mice</h1>
        <p className="text-muted-foreground max-w-md">
          The CRM + POS for WhatsApp-first food businesses — capture sign-ups
          at the counter, take orders, and keep customers coming back.
        </p>
      </div>
      <div className="flex gap-3">
        <Link
          href="/signup"
          className="bg-primary text-primary-foreground rounded-lg px-5 py-2.5 text-sm font-medium"
        >
          Create your shop
        </Link>
        <Link
          href="/login"
          className="border border-input rounded-lg px-5 py-2.5 text-sm text-muted-foreground hover:border-ring"
        >
          Staff login
        </Link>
      </div>
      <p className="text-xs text-muted-foreground/70 max-w-sm text-center">
        Signing up as a customer? Scan your shop&apos;s QR code — every shop
        has its own sign-up page.
      </p>
    </main>
  );
}
