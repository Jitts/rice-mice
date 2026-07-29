"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [mode, setMode] = useState<"signin" | "forgot">("signin");
  const [resetEmail, setResetEmail] = useState("");
  const [resetError, setResetError] = useState<string | null>(null);
  const [resetSent, setResetSent] = useState(false);
  const [resetSending, setResetSending] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      setError("Invalid credentials");
      setLoading(false);
      return;
    }

    router.push("/dashboard");
    router.refresh();
  }

  async function handleResetRequest(e: React.FormEvent) {
    e.preventDefault();
    setResetError(null);
    setResetSending(true);
    const supabase = createClient();
    const { error } = await supabase.auth.resetPasswordForEmail(resetEmail, {
      redirectTo: `${window.location.origin}/auth/callback?next=/reset-password`,
    });
    setResetSending(false);
    // Errors here are ops-facing (e.g. the email provider is down) — surface
    // them plainly. On success, a deliberately generic message: it never
    // confirms whether that address actually has an account.
    if (error) {
      setResetError(error.message);
      return;
    }
    setResetSent(true);
  }

  if (mode === "forgot") {
    return (
      <main className="min-h-screen flex items-center justify-center p-8 bg-background">
        <Card className="w-full max-w-sm">
          <CardHeader className="text-center">
            <p className="text-3xl" aria-hidden>
              🍚🐭
            </p>
            <CardTitle className="font-heading text-2xl">Reset your password</CardTitle>
            <CardDescription>We&apos;ll email you a link to set a new one</CardDescription>
          </CardHeader>
          {resetSent ? (
            <CardContent className="space-y-4">
              <p className="text-sm text-center text-muted-foreground">
                If an account exists for that email, a reset link is on its way.
              </p>
              <button
                type="button"
                onClick={() => {
                  setMode("signin");
                  setResetSent(false);
                  setResetEmail("");
                }}
                className="block w-full text-center text-sm underline underline-offset-4 hover:text-foreground"
              >
                Back to login
              </button>
            </CardContent>
          ) : (
            <form onSubmit={handleResetRequest}>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="reset-email">Email</Label>
                  <Input
                    id="reset-email"
                    required
                    type="email"
                    value={resetEmail}
                    onChange={(e) => setResetEmail(e.target.value)}
                    placeholder="you@yourshop.com"
                  />
                </div>
                {resetError && <p className="text-destructive text-sm">{resetError}</p>}
              </CardContent>
              <CardFooter className="flex-col gap-3 pt-6">
                <Button type="submit" disabled={resetSending} className="w-full">
                  {resetSending ? "Sending…" : "Send reset link"}
                </Button>
                <button
                  type="button"
                  onClick={() => setMode("signin")}
                  className="text-center text-sm underline underline-offset-4 hover:text-foreground"
                >
                  Back to login
                </button>
              </CardFooter>
            </form>
          )}
        </Card>
      </main>
    );
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-8 bg-background">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <p className="text-3xl" aria-hidden>
            🍚🐭
          </p>
          <CardTitle className="font-heading text-2xl">Staff login</CardTitle>
          <CardDescription>Sign in to your shop&apos;s dashboard</CardDescription>
        </CardHeader>
        <form onSubmit={handleSubmit}>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                required
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@yourshop.com"
              />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="password">Password</Label>
                <button
                  type="button"
                  onClick={() => setMode("forgot")}
                  className="text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
                >
                  Forgot password?
                </button>
              </div>
              <Input
                id="password"
                required
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
              />
            </div>
            {searchParams.get("error") === "reset-link-invalid" && (
              <p className="text-destructive text-sm">
                That reset link was invalid or has expired — request a new one below.
              </p>
            )}
            {error && <p className="text-destructive text-sm">{error}</p>}
          </CardContent>
          <CardFooter className="flex-col gap-3 pt-6">
            <Button type="submit" disabled={loading} className="w-full">
              {loading ? "Signing in…" : "Sign in"}
            </Button>
            <p className="text-center text-sm text-muted-foreground">
              New here?{" "}
              <Link
                href="/signup"
                className="underline underline-offset-4 hover:text-foreground"
              >
                Create your shop
              </Link>
            </p>
          </CardFooter>
        </form>
      </Card>
    </main>
  );
}
