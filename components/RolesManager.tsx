"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { ALL, PERMISSIONS, type RoleRow } from "@/lib/permissions";

type Draft = {
  id: string | null; // null = creating
  name: string;
  description: string;
  permissions: string[];
};

const EMPTY_DRAFT: Draft = { id: null, name: "", description: "", permissions: [] };

// Owner-defined roles: pick from the fixed permission catalog, name the
// role, assign it to people on the Team page. The DB enforces the sharp
// edges (system role immutable, self-promotion blocked, last Owner kept).
export function RolesManager({
  roles,
  memberCounts,
}: {
  roles: RoleRow[];
  memberCounts: Record<string, number>;
}) {
  const router = useRouter();
  const [supabase] = useState(() => createClient());
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function togglePerm(id: string) {
    setDraft((d) =>
      d
        ? {
            ...d,
            permissions: d.permissions.includes(id)
              ? d.permissions.filter((p) => p !== id)
              : [...d.permissions, id],
          }
        : d,
    );
  }

  async function saveDraft() {
    if (!draft || !draft.name.trim() || draft.permissions.length === 0) return;
    setBusy(true);
    setError(null);
    const payload = {
      name: draft.name.trim(),
      description: draft.description.trim() || null,
      permissions: draft.permissions,
    };
    const { error: err } = draft.id
      ? await supabase.from("roles").update(payload).eq("id", draft.id)
      : await supabase.from("roles").insert(payload);
    setBusy(false);
    if (err) {
      setError(
        err.code === "23505"
          ? "A role with that name already exists."
          : err.message,
      );
      return;
    }
    setDraft(null);
    router.refresh();
  }

  async function deleteRole(role: RoleRow) {
    if (!confirm(`Delete the role “${role.name}”?`)) return;
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.from("roles").delete().eq("id", role.id);
    setBusy(false);
    if (err) {
      // Trigger message, e.g. members still assigned
      setError(err.message.replace(/^.*?:\s*/, ""));
      return;
    }
    router.refresh();
  }

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-border divide-y">
        {roles.map((r) => (
          <div key={r.id} className="px-3 py-2.5 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium">
                {r.name}
                {r.is_system && (
                  <span className="ml-2 text-xs bg-muted text-muted-foreground rounded-full px-2 py-0.5">
                    system
                  </span>
                )}
                <span className="ml-2 text-xs text-muted-foreground/70">
                  {memberCounts[r.id] ?? 0} member{(memberCounts[r.id] ?? 0) === 1 ? "" : "s"}
                </span>
              </p>
              {r.description && (
                <p className="text-xs text-muted-foreground mt-0.5">{r.description}</p>
              )}
              <p className="mt-1 flex flex-wrap gap-1">
                {r.permissions.includes(ALL) ? (
                  <span className="text-xs bg-primary text-primary-foreground rounded-full px-2 py-0.5">
                    everything
                  </span>
                ) : (
                  PERMISSIONS.filter((p) => r.permissions.includes(p.id)).map((p) => (
                    <span
                      key={p.id}
                      className="text-xs bg-muted text-muted-foreground rounded-full px-2 py-0.5"
                      title={p.description}
                    >
                      {p.label}
                    </span>
                  ))
                )}
              </p>
            </div>
            {!r.is_system && (
              <div className="flex gap-2 shrink-0">
                <button
                  onClick={() =>
                    setDraft({
                      id: r.id,
                      name: r.name,
                      description: r.description ?? "",
                      permissions: r.permissions,
                    })
                  }
                  className="text-xs text-muted-foreground underline hover:text-foreground"
                >
                  edit
                </button>
                <button
                  onClick={() => deleteRole(r)}
                  disabled={busy}
                  className="text-xs text-muted-foreground/70 underline hover:text-destructive"
                >
                  delete
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      {draft ? (
        <div className="rounded-lg border border-input p-3 space-y-3 bg-muted">
          <div className="flex flex-wrap gap-3">
            <label className="block text-sm">
              <span className="block text-xs text-muted-foreground mb-1">Role name</span>
              <input
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder="Shift lead"
                className="border border-input rounded px-2 py-1.5 text-sm w-48 bg-card"
              />
            </label>
            <label className="block text-sm flex-1 min-w-48">
              <span className="block text-xs text-muted-foreground mb-1">Description (optional)</span>
              <input
                value={draft.description}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                placeholder="What this role is for"
                className="border border-input rounded px-2 py-1.5 text-sm w-full bg-card"
              />
            </label>
          </div>
          <div className="grid gap-1.5 sm:grid-cols-2">
            {PERMISSIONS.map((p) => (
              <label key={p.id} className="flex items-start gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={draft.permissions.includes(p.id)}
                  onChange={() => togglePerm(p.id)}
                  className="mt-0.5"
                />
                <span>
                  {p.label}
                  <span className="block text-xs text-muted-foreground/70">{p.description}</span>
                </span>
              </label>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={saveDraft}
              disabled={busy || !draft.name.trim() || draft.permissions.length === 0}
              className="text-sm bg-primary text-primary-foreground rounded px-3 py-1.5 disabled:opacity-50"
            >
              {busy ? "Saving…" : draft.id ? "Save role" : "Create role"}
            </button>
            <button
              onClick={() => setDraft(null)}
              className="text-sm border border-input rounded px-3 py-1.5 text-muted-foreground"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setDraft(EMPTY_DRAFT)}
          className="text-sm border border-input rounded-lg px-4 py-2 text-muted-foreground hover:border-ring"
        >
          + New role
        </button>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
