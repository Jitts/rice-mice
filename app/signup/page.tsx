"use client";

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

export default function StaffSignupPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">(
    "idle",
  );
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("loading");
    setError(null);

    const supabase = createClient();
    const { error } = await supabase.auth.signUp({ email, password });

    if (error) {
      setStatus("error");
      setError(error.message);
      return;
    }

    setStatus("done");
  }

  if (status === "done") {
    return (
      <main className="min-h-screen flex items-center justify-center p-8">
        <div className="text-center space-y-2 max-w-sm">
          <p className="text-xl font-semibold">Account created.</p>
          <p className="text-neutral-500 text-sm">
            <Link href="/login" className="underline">
              Log in
            </Link>{" "}
            to continue.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-8">
      <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-4">
        <h1 className="text-2xl font-bold text-center">
          Create staff account
        </h1>
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
          minLength={6}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password (min 6 chars)"
          className="border rounded px-3 py-2 w-full"
        />
        {status === "error" && error && (
          <p className="text-red-600 text-sm">{error}</p>
        )}
        <button
          type="submit"
          disabled={status === "loading"}
          className="w-full bg-black text-white rounded px-3 py-2 disabled:opacity-50"
        >
          {status === "loading" ? "Creating…" : "Sign up"}
        </button>
        <p className="text-center text-sm text-neutral-500">
          Already have an account?{" "}
          <Link href="/login" className="underline">
            Log in
          </Link>
        </p>
      </form>
    </main>
  );
}
