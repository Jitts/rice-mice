import Link from "next/link";
import { SignupForm } from "@/components/SignupForm";

export default function Home() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-8 gap-6">
      <div className="text-center space-y-1">
        <h1 className="text-4xl font-bold tracking-tight">🍚🐭 rice-mice</h1>
        <p className="text-neutral-500">
          Sign up in seconds — we&apos;ll keep you in the loop on WhatsApp.
        </p>
      </div>
      <SignupForm />
      <Link href="/dashboard" className="text-sm text-neutral-400 underline">
        Staff dashboard →
      </Link>
    </main>
  );
}
