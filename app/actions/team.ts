"use server";

// Account administration — the reason nobody needs the Supabase dashboard.
// Every action re-verifies server-side that the CALLER's membership role
// includes the 'team' permission, and — since Sprint 32 — that the TARGET
// belongs to the caller's business, because the service-role client bypasses
// RLS and these filters are the tenant boundary. Every action writes an
// audit_log row.

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export type TeamActionResult = { ok: true } | { ok: false; error: string };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;
// Effectively permanent; lifted by setting ban_duration to "none".
const BAN_DURATION = "87600h";

type Caller = { userId: string; businessId: string; displayName: string | null };

async function requireTeamCaller(): Promise<
  { ok: true; caller: Caller } | { ok: false; error: string }
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in" };
  const [{ data: membership }, { data: profile }] = await Promise.all([
    supabase
      .from("memberships")
      .select("business_id, roles(permissions)")
      .maybeSingle(),
    supabase
      .from("staff_profiles")
      .select("display_name")
      .eq("id", user.id)
      .maybeSingle(),
  ]);
  const m = membership as {
    business_id: string;
    roles: { permissions: string[] } | null;
  } | null;
  const perms = m?.roles?.permissions ?? [];
  if (!m || (!perms.includes("*") && !perms.includes("team")))
    return { ok: false, error: "Your role doesn't include team management" };
  return {
    ok: true,
    caller: {
      userId: user.id,
      businessId: m.business_id,
      displayName: profile?.display_name ?? null,
    },
  };
}

function admin() {
  const client = createAdminClient();
  if (!client)
    throw new Error(
      "Account admin isn't configured — SUPABASE_SERVICE_ROLE_KEY is missing",
    );
  return client;
}

type AdminApi = ReturnType<typeof admin>;

// The tenant fence: a target user is only administrable if they hold a
// membership in the CALLER's business.
async function targetMembership(
  api: AdminApi,
  businessId: string,
  userId: string,
): Promise<{ id: string; role_id: string | null } | null> {
  const { data } = await api
    .from("memberships")
    .select("id, role_id")
    .eq("business_id", businessId)
    .eq("user_id", userId)
    .maybeSingle();
  return data ?? null;
}

async function audit(
  api: AdminApi,
  caller: Caller,
  action: string,
  targetId: string,
  payload: Record<string, unknown> = {},
  outcome: "success" | "failed" = "success",
) {
  await api.from("audit_log").insert({
    business_id: caller.businessId,
    actor: caller.displayName ?? caller.userId,
    action,
    target_id: targetId,
    payload_snapshot: payload,
    outcome,
  });
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

    // The role must belong to the caller's business; missing/foreign role
    // falls back to that business's own Staff role.
    let roleId = input.roleId;
    if (roleId) {
      const { data: role } = await api
        .from("roles")
        .select("id")
        .eq("id", roleId)
        .eq("business_id", gate.caller.businessId)
        .maybeSingle();
      if (!role) roleId = null;
    }
    if (!roleId) {
      const { data: staffRole } = await api
        .from("roles")
        .select("id")
        .eq("business_id", gate.caller.businessId)
        .eq("name", "Staff")
        .maybeSingle();
      roleId = staffRole?.id ?? null;
    }

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
    });
    const { error: memberErr } = profileErr
      ? { error: profileErr }
      : await api.from("memberships").insert({
          business_id: gate.caller.businessId,
          user_id: data.user.id,
          role_id: roleId,
        });
    if (profileErr || memberErr) {
      // Don't leave a half-created login behind.
      await api.auth.admin.deleteUser(data.user.id);
      return { ok: false, error: "Could not create the profile — try again" };
    }
    await audit(api, gate.caller, "team.member_created", data.user.id, {
      email,
      display_name: displayName,
      role_id: roleId,
    });
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
    const api = admin();
    if (!(await targetMembership(api, gate.caller.businessId, userId)))
      return { ok: false, error: "That person isn't on your team" };
    const { error } = await api.auth.admin.updateUserById(userId, {
      password: newPassword,
    });
    if (error) return { ok: false, error: error.message };
    await audit(api, gate.caller, "team.password_reset", userId);
    return { ok: true };
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
    const api = admin();
    if (!(await targetMembership(api, gate.caller.businessId, userId)))
      return { ok: false, error: "That person isn't on your team" };
    const { error } = await api.auth.admin.updateUserById(userId, {
      email,
      email_confirm: true,
    });
    if (error)
      return {
        ok: false,
        error: /already/i.test(error.message)
          ? "Another account already uses that email"
          : error.message,
      };
    await audit(api, gate.caller, "team.email_changed", userId, { email });
    return { ok: true };
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
    if (!(await targetMembership(api, gate.caller.businessId, userId)))
      return { ok: false, error: "That person isn't on your team" };
    if (!active) {
      // Never deactivate the last ACTIVE Owner of this business — a lockout.
      const { data: owners } = await api
        .from("memberships")
        .select("user_id, roles!inner(is_system)")
        .eq("business_id", gate.caller.businessId)
        .eq("roles.is_system", true);
      const ownerIds = new Set((owners ?? []).map((o) => o.user_id));
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
    if (error) return { ok: false, error: error.message };
    await audit(
      api,
      gate.caller,
      active ? "team.member_reactivated" : "team.member_deactivated",
      userId,
    );
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed" };
  }
}
