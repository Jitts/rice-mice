"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
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

const MIN_PASSWORD_LENGTH = 8;

export default function ResetPasswordPage() {
  const router = useRouter();
  // The recovery link's session is established by /auth/callback before this
  // page ever loads, so "signed in" here means "this link was valid" — a
  // stale or already-used link leaves no session and lands in "invalid".
  const [status, setStatus] = useState<"checking" | "ready" | "invalid">("checking");
  const [pw1, setPw1] = useState("");
  const [pw2, setPw2] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    createClient()
      .auth.getUser()
      .then(({ data: { user } }) => setStatus(user ? "ready" : "invalid"));
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (pw1.length < MIN_PASSWORD_LENGTH) {
      setError(`Use at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (pw1 !== pw2) {
      setError("The two entries don't match.");
      return;
    }
    setSaving(true);
    const { error: updateError } = await createClient().auth.updateUser({ password: pw1 });
    setSaving(false);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    setDone(true);
    setTimeout(() => router.push("/dashboard"), 1200);
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-8 bg-background">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <p className="text-3xl" aria-hidden>
            🍚🐭
          </p>
          <CardTitle className="font-heading text-2xl">Set a new password</CardTitle>
          <CardDescription>Choose a new password for your account</CardDescription>
        </CardHeader>

        {status === "checking" && (
          <CardContent>
            <p className="text-sm text-center text-muted-foreground">Checking your link…</p>
          </CardContent>
        )}

        {status === "invalid" && (
          <CardContent className="space-y-4">
            <p className="text-destructive text-sm text-center">
              This reset link is invalid or has expired — request a new one from the login page.
            </p>
            <Link
              href="/login"
              className="block text-center text-sm underline underline-offset-4 hover:text-foreground"
            >
              Back to login
            </Link>
          </CardContent>
        )}

        {status === "ready" && done && (
          <CardContent>
            <p className="text-sm text-center text-muted-foreground">
              Password updated — taking you to your dashboard…
            </p>
          </CardContent>
        )}

        {status === "ready" && !done && (
          <form onSubmit={handleSubmit}>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="pw1">New password</Label>
                <Input
                  id="pw1"
                  required
                  type="password"
                  value={pw1}
                  onChange={(e) => setPw1(e.target.value)}
                  placeholder="••••••••"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="pw2">Confirm password</Label>
                <Input
                  id="pw2"
                  required
                  type="password"
                  value={pw2}
                  onChange={(e) => setPw2(e.target.value)}
                  placeholder="••••••••"
                />
              </div>
              {error && <p className="text-destructive text-sm">{error}</p>}
            </CardContent>
            <CardFooter>
              <Button type="submit" disabled={saving} className="w-full">
                {saving ? "Saving…" : "Set new password"}
              </Button>
            </CardFooter>
          </form>
        )}
      </Card>
    </main>
  );
}
