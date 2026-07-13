"use client";

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { CreateShopForm } from "@/components/CreateShopForm";

// Self-serve onboarding: create a login, then name the shop. Staff accounts
// for an EXISTING shop are created by its owner on the Team page — this page
// is for new shops. If email confirmation is on for this Supabase project,
// step 2 happens on first login instead (the dashboard shows the same form).

export default function CreateShopPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [step, setStep] = useState<"account" | "shop" | "confirm">("account");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function createAccount(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { data, error } = await supabase.auth.signUp({ email, password });
    setBusy(false);
    if (error) {
      setError(error.message);
      return;
    }
    // With email confirmation off we get a session and can finish setup now;
    // with it on, the shop form greets them after their first login.
    setStep(data.session ? "shop" : "confirm");
  }

  if (step === "shop") {
    return (
      <main className="min-h-screen flex items-center justify-center p-8">
        <div className="w-full max-w-md space-y-6">
          <div className="text-center space-y-1">
            <h1 className="text-2xl font-bold tracking-tight">
              Create your shop
            </h1>
            <p className="text-sm text-neutral-500">
              Account ready — now claim your shop&apos;s name and sign-up link.
            </p>
          </div>
          <CreateShopForm />
        </div>
      </main>
    );
  }

  if (step === "confirm") {
    return (
      <main className="min-h-screen flex items-center justify-center p-8">
        <div className="text-center space-y-2 max-w-sm">
          <p className="text-xl font-semibold">Check your email</p>
          <p className="text-neutral-500 text-sm">
            Confirm your address, then{" "}
            <Link href="/login" className="underline">
              log in
            </Link>{" "}
            — we&apos;ll set up your shop right after.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-8">
      <form onSubmit={createAccount} className="w-full max-w-sm space-y-4">
        <div className="text-center space-y-1">
          <h1 className="text-2xl font-bold">Create your shop</h1>
          <p className="text-sm text-neutral-500">
            Step 1 of 2 — your owner login.
          </p>
        </div>
        <input
          required
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email"
          className="border rounded px-3 py-2 w-full"
        />
        <input
          required
          type="password"
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password (min 8 chars)"
          className="border rounded px-3 py-2 w-full"
        />
        {error && <p className="text-red-600 text-sm">{error}</p>}
        <button
          type="submit"
          disabled={busy}
          className="w-full bg-black text-white rounded px-3 py-2 disabled:opacity-50"
        >
          {busy ? "Creating…" : "Continue"}
        </button>
        <p className="text-center text-sm text-neutral-500">
          Already have an account?{" "}
          <Link href="/login" className="underline">
            Log in
          </Link>
        </p>
        <p className="text-center text-xs text-neutral-400">
          Joining an existing shop? Ask its owner to add you from their Team
          page.
        </p>
      </form>
    </main>
  );
}
