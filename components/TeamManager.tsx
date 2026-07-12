"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export type TeamMember = {
  id: string;
  display_name: string;
  created_at: string;
};

export function TeamManager({
  members,
  ownId,
  ownEmail,
}: {
  members: TeamMember[];
  ownId: string | null;
  ownEmail: string | null;
}) {
  const router = useRouter();
  const [supabase] = useState(() => createClient());
  const own = members.find((m) => m.id === ownId);
  const [name, setName] = useState(own?.display_name ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function saveName() {
    const trimmed = name.trim();
    if (!ownId || !trimmed || trimmed === own?.display_name) return;
    setSaving(true);
    setError(null);
    const { error: err } = await supabase
      .from("staff_profiles")
      .update({ display_name: trimmed })
      .eq("id", ownId);
    setSaving(false);
    if (err) {
      setError("Could not save — try again.");
      return;
    }
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
    // Refresh so the sidebar (server-provided profile) picks up the new name.
    router.refresh();
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Team</h1>
        <p className="text-sm text-neutral-500 mt-1">
          Your display name is stamped on the orders you take and the messages
          you send, so results can be traced back to a person.
        </p>
      </div>

      <div className="rounded-xl border border-neutral-200 bg-white p-4 space-y-3">
        <h2 className="text-sm font-semibold">Your profile</h2>
        <p className="text-xs text-neutral-500">
          Signed in as <span className="font-medium">{ownEmail ?? "unknown"}</span>
        </p>
        <div className="flex items-center gap-2">
          <label className="text-xs text-neutral-500">Display name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="border border-neutral-300 rounded px-2 py-1.5 text-sm w-56"
          />
          <button
            onClick={saveName}
            disabled={saving || !name.trim() || name.trim() === own?.display_name}
            className="text-sm bg-neutral-900 text-white rounded px-3 py-1.5 disabled:opacity-50"
          >
            {saving ? "Saving…" : saved ? "Saved ✓" : "Save"}
          </button>
        </div>
        {error && <p className="text-xs text-red-600">{error}</p>}
      </div>

      <div className="rounded-xl border border-neutral-200 bg-white divide-y">
        {members.map((m) => (
          <div key={m.id} className="px-4 py-3 flex items-center justify-between">
            <span className="text-sm font-medium">
              {m.display_name}
              {m.id === ownId && (
                <span className="ml-2 text-xs bg-neutral-100 text-neutral-500 rounded-full px-2 py-0.5">
                  you
                </span>
              )}
            </span>
            <span className="text-xs text-neutral-400">
              joined {new Date(m.created_at).toLocaleDateString()}
            </span>
          </div>
        ))}
        {members.length === 0 && (
          <p className="px-4 py-3 text-sm text-neutral-500">No profiles yet.</p>
        )}
      </div>

      <div className="rounded-xl border border-dashed border-neutral-300 bg-neutral-50 p-4">
        <h2 className="text-sm font-semibold mb-1">Adding a staff account</h2>
        <p className="text-xs text-neutral-500">
          Accounts are created by the owner in Supabase → Authentication →
          Users → Add user (email + password). The new person appears in this
          list automatically after their first sign-in, named after their email
          — they can change their display name here.
        </p>
      </div>
    </div>
  );
}
