"use client";

import { useEffect, useState } from "react";
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

  // Resend of the confirmation email, with a cooldown so we respect Supabase's
  // own resend rate limit (~60s) instead of letting people hammer it.
  const [resendState, setResendState] = useState<"idle" | "sending" | "sent">("idle");
  const [resendError, setResendError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

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

  async function resendConfirmation() {
    if (cooldown > 0 || resendState === "sending") return;
    setResendState("sending");
    setResendError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.resend({ type: "signup", email });
    if (error) {
      setResendState("idle");
      setResendError(error.message);
      return;
    }
    setResendState("sent");
    setCooldown(60);
  }

  if (step === "shop") {
    return (
      <main className="min-h-screen flex items-center justify-center p-8">
        <div className="w-full max-w-md space-y-6">
          <div className="text-center space-y-1">
            <h1 className="font-heading text-2xl font-bold tracking-tight">
              Create your shop
            </h1>
            <p className="text-sm text-muted-foreground">
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
        <div className="text-center space-y-3 max-w-sm">
          <p className="text-xl font-semibold">Check your email</p>
          <p className="text-muted-foreground text-sm">
            We sent a confirmation link to{" "}
            <span className="font-medium text-foreground/80">{email}</span>. Confirm
            your address, then{" "}
            <Link href="/login" className="underline">
              log in
            </Link>{" "}
            — we&apos;ll set up your shop right after.
          </p>

          <div className="pt-1 space-y-1">
            <button
              type="button"
              onClick={resendConfirmation}
              disabled={cooldown > 0 || resendState === "sending"}
              className="text-sm border border-input rounded px-4 py-2 text-foreground/80 hover:border-ring disabled:opacity-50"
            >
              {resendState === "sending"
                ? "Sending…"
                : cooldown > 0
                  ? `Resend in ${cooldown}s`
                  : "Resend confirmation email"}
            </button>
            {resendState === "sent" && cooldown > 0 && (
              <p className="text-xs text-green-600">
                Sent again — check your inbox and spam folder.
              </p>
            )}
            {resendError && <p className="text-xs text-destructive">{resendError}</p>}
          </div>

          <p className="text-xs text-muted-foreground/70">
            Wrong address?{" "}
            <button
              type="button"
              onClick={() => {
                setStep("account");
                setResendState("idle");
                setResendError(null);
                setCooldown(0);
              }}
              className="underline"
            >
              Go back and re-enter it
            </button>
            .
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-8">
      <form onSubmit={createAccount} className="w-full max-w-sm space-y-4">
        <div className="text-center space-y-1">
          <h1 className="font-heading text-2xl font-bold">Create your shop</h1>
          <p className="text-sm text-muted-foreground">
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
        {error && <p className="text-destructive text-sm">{error}</p>}
        <button
          type="submit"
          disabled={busy}
          className="w-full bg-primary text-primary-foreground rounded px-3 py-2 disabled:opacity-50"
        >
          {busy ? "Creating…" : "Continue"}
        </button>
        <p className="text-center text-sm text-muted-foreground">
          Already have an account?{" "}
          <Link href="/login" className="underline">
            Log in
          </Link>
        </p>
        <p className="text-center text-xs text-muted-foreground/70">
          Joining an existing shop? Ask its owner to add you from their Team
          page.
        </p>
      </form>
    </main>
  );
}
