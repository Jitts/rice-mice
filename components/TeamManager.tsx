"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { can, defaultRoleId, type RoleRow } from "@/lib/permissions";
import {
  createStaffAccount,
  resetStaffPassword,
  setStaffActive,
  updateStaffEmail,
} from "@/app/actions/team";

export type TeamMember = {
  id: string; // auth user id
  membership_id: string; // roles are assigned on the membership (Sprint 32)
  display_name: string;
  created_at: string;
  role_id: string | null;
  roles: { name: string } | null;
};

export type AccountInfo = { email: string | null; banned: boolean };

type RowPanel = { memberId: string; kind: "email" | "password" } | null;

export function TeamManager({
  members,
  roles,
  callerPermissions,
  accounts,
  adminReady,
  ownId,
  ownEmail,
}: {
  members: TeamMember[];
  roles: RoleRow[];
  callerPermissions: string[];
  accounts: Record<string, AccountInfo>;
  adminReady: boolean;
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

  const [rowBusy, setRowBusy] = useState<string | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [rowNotes, setRowNotes] = useState<Record<string, string>>({});
  const [panel, setPanel] = useState<RowPanel>(null);
  const [panelValue, setPanelValue] = useState("");
  const [showPanelPw, setShowPanelPw] = useState(false);

  // add-member form
  const [newEmail, setNewEmail] = useState("");
  const [newName, setNewName] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRoleId, setNewRoleId] = useState<string>(() => defaultRoleId(roles));
  const [addBusy, setAddBusy] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [addDone, setAddDone] = useState<string | null>(null);

  const canAssign = can(callerPermissions, "team");

  function setRowError(id: string, msg: string | null) {
    setRowErrors((e) => {
      const next = { ...e };
      if (msg) next[id] = msg;
      else delete next[id];
      return next;
    });
  }

  function setRowNote(id: string, msg: string | null) {
    setRowNotes((n) => {
      const next = { ...n };
      if (msg) next[id] = msg;
      else delete next[id];
      return next;
    });
  }

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
    router.refresh();
  }

  // The DB trigger is the real gate: it requires the 'team' permission and
  // refuses to demote the last Owner — we just surface its message.
  async function assignRole(member: TeamMember, roleId: string) {
    setRowBusy(member.id);
    setRowError(member.id, null);
    const { error: err } = await supabase
      .from("memberships")
      .update({ role_id: roleId || null })
      .eq("id", member.membership_id);
    setRowBusy(null);
    if (err) {
      setRowError(member.id, err.message.replace(/^.*?:\s*/, ""));
      return;
    }
    router.refresh();
  }

  async function submitPanel(member: TeamMember) {
    if (!panel || panel.memberId !== member.id) return;
    setRowBusy(member.id);
    setRowError(member.id, null);
    setRowNote(member.id, null);
    const res =
      panel.kind === "email"
        ? await updateStaffEmail(member.id, panelValue)
        : await resetStaffPassword(member.id, panelValue);
    setRowBusy(null);
    if (!res.ok) {
      setRowError(member.id, res.error);
      return;
    }
    setPanel(null);
    setPanelValue("");
    setRowNote(
      member.id,
      panel.kind === "email" ? "Email updated ✓" : "Password reset ✓ — tell them the new one",
    );
    router.refresh();
  }

  async function toggleActive(member: TeamMember, active: boolean) {
    if (
      !active &&
      !confirm(`Deactivate ${member.display_name}? They won't be able to sign in until reactivated.`)
    )
      return;
    setRowBusy(member.id);
    setRowError(member.id, null);
    const res = await setStaffActive(member.id, active);
    setRowBusy(null);
    if (!res.ok) {
      setRowError(member.id, res.error);
      return;
    }
    router.refresh();
  }

  async function addMember() {
    setAddBusy(true);
    setAddError(null);
    setAddDone(null);
    const res = await createStaffAccount({
      email: newEmail,
      password: newPassword,
      displayName: newName,
      roleId: newRoleId || null,
    });
    setAddBusy(false);
    if (!res.ok) {
      setAddError(res.error);
      return;
    }
    setAddDone(`${newName.trim()} can now sign in with ${newEmail.trim()} and the password you set.`);
    setNewEmail("");
    setNewName("");
    setNewPassword("");
    setNewRoleId(defaultRoleId(roles));
    router.refresh();
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-bold tracking-tight">Team</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Your display name is stamped on the orders you take and the messages
          you send; your role decides what you can do.
        </p>
      </div>

      <div className="rounded-xl border border-border bg-card p-4 space-y-3">
        <h2 className="text-sm font-semibold">Your profile</h2>
        <p className="text-xs text-muted-foreground">
          Signed in as <span className="font-medium">{ownEmail ?? "unknown"}</span>
          {own?.roles?.name ? (
            <>
              {" · role: "}
              <span className="font-medium">{own.roles.name}</span>
            </>
          ) : (
            " · no role assigned yet"
          )}
        </p>
        <div className="flex items-center gap-2">
          <label className="text-xs text-muted-foreground">Display name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="border border-input rounded px-2 py-1.5 text-sm w-56"
          />
          <button
            onClick={saveName}
            disabled={saving || !name.trim() || name.trim() === own?.display_name}
            className="text-sm bg-primary text-primary-foreground rounded px-3 py-1.5 disabled:opacity-50"
          >
            {saving ? "Saving…" : saved ? "Saved ✓" : "Save"}
          </button>
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>

      <div className="rounded-xl border border-border bg-card divide-y">
        {members.map((m) => {
          const acct = accounts[m.id];
          const isOpen = panel?.memberId === m.id;
          return (
            <div key={m.id} className="px-4 py-3">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <span className="text-sm font-medium min-w-0">
                  {m.display_name}
                  {m.id === ownId && (
                    <span className="ml-2 text-xs bg-muted text-muted-foreground rounded-full px-2 py-0.5">
                      you
                    </span>
                  )}
                  {acct?.banned && (
                    <span className="ml-2 text-xs bg-destructive/10 text-destructive rounded-full px-2 py-0.5">
                      deactivated
                    </span>
                  )}
                </span>
                <span className="flex items-center gap-3">
                  {canAssign ? (
                    <select
                      value={m.role_id ?? ""}
                      disabled={rowBusy === m.id}
                      onChange={(e) => assignRole(m, e.target.value)}
                      className="text-sm border border-input rounded px-2 py-1"
                    >
                      <option value="">no role (locked out)</option>
                      {roles.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      {m.roles?.name ?? "no role"}
                    </span>
                  )}
                  <span className="text-xs text-muted-foreground/70">
                    joined {new Date(m.created_at).toLocaleDateString()}
                  </span>
                </span>
              </div>

              {canAssign && adminReady && (
                <div className="mt-1.5 flex items-center gap-3 flex-wrap text-xs">
                  <span className="text-muted-foreground">{acct?.email ?? "—"}</span>
                  <button
                    onClick={() => {
                      setPanel(isOpen && panel.kind === "email" ? null : { memberId: m.id, kind: "email" });
                      setPanelValue(acct?.email ?? "");
                      setShowPanelPw(false);
                      setRowNote(m.id, null);
                    }}
                    className="text-muted-foreground/70 underline hover:text-foreground"
                  >
                    change email
                  </button>
                  <button
                    onClick={() => {
                      setPanel(isOpen && panel.kind === "password" ? null : { memberId: m.id, kind: "password" });
                      setPanelValue("");
                      setShowPanelPw(false);
                      setRowNote(m.id, null);
                    }}
                    className="text-muted-foreground/70 underline hover:text-foreground"
                  >
                    reset password
                  </button>
                  {m.id !== ownId &&
                    (acct?.banned ? (
                      <button
                        onClick={() => toggleActive(m, true)}
                        disabled={rowBusy === m.id}
                        className="text-emerald-600 underline"
                      >
                        reactivate
                      </button>
                    ) : (
                      <button
                        onClick={() => toggleActive(m, false)}
                        disabled={rowBusy === m.id}
                        className="text-muted-foreground/70 underline hover:text-destructive"
                      >
                        deactivate
                      </button>
                    ))}
                </div>
              )}

              {isOpen && (
                <div className="mt-2 space-y-1.5">
                  <div className="flex items-center gap-2">
                    <input
                      type={
                        panel.kind === "password"
                          ? showPanelPw
                            ? "text"
                            : "password"
                          : "email"
                      }
                      value={panelValue}
                      onChange={(e) => setPanelValue(e.target.value)}
                      placeholder={panel.kind === "password" ? "New password (min 8 chars)" : "new@email.com"}
                      className="border border-input rounded px-2 py-1.5 text-sm w-64"
                    />
                    <button
                      onClick={() => submitPanel(m)}
                      disabled={rowBusy === m.id || !panelValue.trim()}
                      className="text-sm bg-primary text-primary-foreground rounded px-3 py-1.5 disabled:opacity-50"
                    >
                      {rowBusy === m.id
                        ? "Saving…"
                        : panel.kind === "password"
                          ? "Set password"
                          : "Update email"}
                    </button>
                    <button
                      onClick={() => setPanel(null)}
                      className="text-sm border border-input rounded px-3 py-1.5 text-muted-foreground"
                    >
                      Cancel
                    </button>
                  </div>
                  {panel.kind === "password" && (
                    <label className="flex items-center gap-1.5 text-xs text-muted-foreground select-none">
                      <input
                        type="checkbox"
                        checked={showPanelPw}
                        onChange={(e) => setShowPanelPw(e.target.checked)}
                        className="h-3.5 w-3.5"
                      />
                      Show password — check what you typed before setting it
                    </label>
                  )}
                </div>
              )}
              {rowNotes[m.id] && (
                <p className="text-xs text-emerald-600 mt-1">{rowNotes[m.id]}</p>
              )}
              {rowErrors[m.id] && (
                <p className="text-xs text-destructive mt-1">{rowErrors[m.id]}</p>
              )}
            </div>
          );
        })}
        {members.length === 0 && (
          <p className="px-4 py-3 text-sm text-muted-foreground">No profiles yet.</p>
        )}
      </div>

      {canAssign &&
        (adminReady ? (
          <div className="rounded-xl border border-border bg-card p-4 space-y-3">
            <h2 className="text-sm font-semibold">Add a team member</h2>
            <p className="text-xs text-muted-foreground">
              They sign in with this email and password right away — no
              Supabase, no confirmation email. Share the password with them and
              they can change it in Settings.
            </p>
            <div className="flex flex-wrap gap-3">
              <label className="block text-sm">
                <span className="block text-xs text-muted-foreground mb-1">Email</span>
                <input
                  type="email"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  placeholder="them@example.com"
                  className="border border-input rounded px-2 py-1.5 text-sm w-56"
                />
              </label>
              <label className="block text-sm">
                <span className="block text-xs text-muted-foreground mb-1">Display name</span>
                <input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Naledi"
                  className="border border-input rounded px-2 py-1.5 text-sm w-40"
                />
              </label>
              <label className="block text-sm">
                <span className="block text-xs text-muted-foreground mb-1">Temporary password</span>
                <input
                  type="text"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="min 8 characters"
                  className="border border-input rounded px-2 py-1.5 text-sm w-44"
                />
              </label>
              <label className="block text-sm">
                <span className="block text-xs text-muted-foreground mb-1">Role</span>
                <select
                  value={newRoleId}
                  onChange={(e) => setNewRoleId(e.target.value)}
                  className="border border-input rounded px-2 py-1.5 text-sm"
                >
                  {roles.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={addMember}
                disabled={addBusy || !newEmail.trim() || !newName.trim() || !newPassword}
                className="text-sm bg-primary text-primary-foreground rounded px-3 py-1.5 disabled:opacity-50"
              >
                {addBusy ? "Creating…" : "Create account"}
              </button>
              {addError && <p className="text-xs text-destructive">{addError}</p>}
              {addDone && <p className="text-xs text-emerald-600">{addDone}</p>}
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-input bg-muted p-4">
            <h2 className="text-sm font-semibold mb-1">Add a team member</h2>
            <p className="text-xs text-muted-foreground">
              Account admin isn&apos;t configured on this deployment —
              SUPABASE_SERVICE_ROLE_KEY is missing from the server environment.
            </p>
          </div>
        ))}
    </div>
  );
}
