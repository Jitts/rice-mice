"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// Self-serve onboarding: names the shop, claims its public sign-up link, and
// calls the create_business RPC (which seeds roles, providers, a starter menu
// and rewards, and makes the caller Owner). Used on /signup after account
// creation AND as the dashboard's "no shop yet" state.

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

export function CreateShopForm({ showSignOut = false }: { showSignOut?: boolean }) {
  const router = useRouter();
  const [supabase] = useState(() => createClient());
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const { error: err } = await supabase.rpc("create_business", {
      p_name: name.trim(),
      p_slug: slug.trim(),
    });
    if (err) {
      setBusy(false);
      // The RPC raises human-readable messages (taken/reserved/invalid slug…).
      setError(err.message.replace(/^.*?:\s*/, ""));
      return;
    }
    router.push("/dashboard");
    router.refresh();
  }

  async function signOut() {
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 w-full max-w-md">
      <label className="block text-sm">
        <span className="block text-xs text-muted-foreground mb-1">Shop name</span>
        <input
          required
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            if (!slugTouched) setSlug(slugify(e.target.value));
          }}
          placeholder="Kofi Corner ☕"
          className="border rounded px-3 py-2 w-full"
        />
      </label>
      <label className="block text-sm">
        <span className="block text-xs text-muted-foreground mb-1">
          Your sign-up link (customers scan a QR to reach it)
        </span>
        <span className="flex items-center border rounded overflow-hidden">
          <span className="px-3 py-2 text-sm text-muted-foreground/70 bg-muted whitespace-nowrap">
            /s/
          </span>
          <input
            required
            value={slug}
            onChange={(e) => {
              setSlugTouched(true);
              setSlug(slugify(e.target.value));
            }}
            placeholder="kofi-corner"
            className="px-2 py-2 w-full outline-none"
          />
        </span>
        <span className="block text-[11px] text-muted-foreground/70 mt-1">
          Lowercase letters, numbers and dashes. This can&apos;t be changed easily
          later — pick something short.
        </span>
      </label>
      {error && <p className="text-destructive text-sm">{error}</p>}
      <button
        type="submit"
        disabled={busy || !name.trim() || slug.trim().length < 3}
        className="w-full bg-primary text-primary-foreground rounded px-3 py-2 disabled:opacity-50"
      >
        {busy ? "Creating…" : "Create shop"}
      </button>
      <p className="text-xs text-muted-foreground/70">
        You&apos;ll get Owner access, a starter menu and two example rewards —
        all editable. No fake customers.
      </p>
      {showSignOut && (
        <button
          type="button"
          onClick={signOut}
          className="w-full border border-input rounded px-3 py-2 text-sm text-muted-foreground"
        >
          Sign out
        </button>
      )}
    </form>
  );
}
