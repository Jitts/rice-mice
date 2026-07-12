"use server";

// Account administration — the reason nobody needs the Supabase dashboard.
// Every action re-verifies server-side that the CALLER's role includes the
// 'team' permission before touching the admin API; the service-role key
// never leaves this module's process.

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { OWNER_ROLE_ID } from "@/lib/permissions";

export type TeamActionResult = { ok: true } | { ok: false; error: string };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;
// Effectively permanent; lifted by setting ban_duration to "none".
const BAN_DURATION = "87600h";

type Caller = { userId: string };

async function requireTeamCaller(): Promise<
  { ok: true; caller: Caller } | { ok: false; error: string }
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in" };
  const { data } = await supabase
    .from("staff_profiles")
    .select("roles(permissions)")
    .eq("id", user.id)
    .maybeSingle();
  const perms =
    (data as { roles: { permissions: string[] } | null } | null)?.roles
      ?.permissions ?? [];
  if (!perms.includes("*") && !perms.includes("team"))
    return { ok: false, error: "Your role doesn't include team management" };
  return { ok: true, caller: { userId: user.id } };
}

function admin() {
  const client = createAdminClient();
  if (!client)
    throw new Error(
      "Account admin isn't configured — SUPABASE_SERVICE_ROLE_KEY is missing",
    );
  return client;
}

export async function createStaffAccount(input: {
  email: string;
  password: string;
  displayName: string;
  roleId: string | null;
}): Promise<TeamActionResult> {
  const gate = await requireTeamCaller();
  if (!gate.ok) return gate;
  const email = input.email.trim().toLowerCase();
  const displayName = input.displayName.trim();
  if (!EMAIL_RE.test(email)) return { ok: false, error: "That email looks invalid" };
  if (input.password.length < MIN_PASSWORD_LENGTH)
    return { ok: false, error: `Password needs at least ${MIN_PASSWORD_LENGTH} characters` };
  if (!displayName) return { ok: false, error: "Give them a display name" };

  try {
    const api = admin();
    const { data, error } = await api.auth.admin.createUser({
      email,
      password: input.password,
      email_confirm: true, // no confirmation email round-trip needed
    });
    if (error || !data.user)
      return {
        ok: false,
        error: /already/i.test(error?.message ?? "")
          ? "An account with that email already exists"
          : (error?.message ?? "Could not create the account"),
      };
    const { error: profileErr } = await api.from("staff_profiles").insert({
      id: data.user.id,
      display_name: displayName,
      role_id: input.roleId,
    });
    if (profileErr) {
      // Don't leave a half-created login behind.
      await api.auth.admin.deleteUser(data.user.id);
      return { ok: false, error: "Could not create the profile — try again" };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed" };
  }
}

export async function resetStaffPassword(
  userId: string,
  newPassword: string,
): Promise<TeamActionResult> {
  const gate = await requireTeamCaller();
  if (!gate.ok) return gate;
  if (newPassword.length < MIN_PASSWORD_LENGTH)
    return { ok: false, error: `Password needs at least ${MIN_PASSWORD_LENGTH} characters` };
  try {
    const { error } = await admin().auth.admin.updateUserById(userId, {
      password: newPassword,
    });
    return error ? { ok: false, error: error.message } : { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed" };
  }
}

export async function updateStaffEmail(
  userId: string,
  newEmail: string,
): Promise<TeamActionResult> {
  const gate = await requireTeamCaller();
  if (!gate.ok) return gate;
  const email = newEmail.trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return { ok: false, error: "That email looks invalid" };
  try {
    const { error } = await admin().auth.admin.updateUserById(userId, {
      email,
      email_confirm: true,
    });
    return error
      ? {
          ok: false,
          error: /already/i.test(error.message)
            ? "Another account already uses that email"
            : error.message,
        }
      : { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed" };
  }
}

export async function setStaffActive(
  userId: string,
  active: boolean,
): Promise<TeamActionResult> {
  const gate = await requireTeamCaller();
  if (!gate.ok) return gate;
  if (!active && userId === gate.caller.userId)
    return { ok: false, error: "You can't deactivate yourself — ask another owner" };
  try {
    const api = admin();
    if (!active) {
      // Never deactivate the last ACTIVE Owner — that's a lockout.
      const { data: owners } = await api
        .from("staff_profiles")
        .select("id")
        .eq("role_id", OWNER_ROLE_ID);
      const ownerIds = new Set((owners ?? []).map((o) => o.id));
      if (ownerIds.has(userId)) {
        const { data: list } = await api.auth.admin.listUsers();
        const now = Date.now();
        const otherActiveOwners = (list?.users ?? []).filter((u) => {
          const banned =
            "banned_until" in u &&
            u.banned_until &&
            new Date(u.banned_until as string).getTime() > now;
          return u.id !== userId && ownerIds.has(u.id) && !banned;
        });
        if (otherActiveOwners.length === 0)
          return { ok: false, error: "At least one active Owner must remain" };
      }
    }
    const { error } = await api.auth.admin.updateUserById(userId, {
      ban_duration: active ? "none" : BAN_DURATION,
    });
    return error ? { ok: false, error: error.message } : { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed" };
  }
}
