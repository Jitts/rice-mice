import { createClient } from "@/lib/supabase/server";
import { DashboardShell } from "@/components/DashboardShell";
import { CreateShopForm } from "@/components/CreateShopForm";
import { brandLine, withBusinessDefaults } from "@/lib/business";
import { withRuleDefaults } from "@/lib/marketing";
import { withLoyaltyDefaults } from "@/lib/loyalty";
import { loadFindings, countPendingProposals } from "@/lib/loadFindings";
import { can } from "@/lib/permissions";
import type { StaffAccess } from "@/components/StaffContext";

type MembershipRow = {
  business_id: string;
  roles: { name: string; permissions: string[] } | null;
  businesses: Record<string, unknown> | null;
};

// Resolves the signed-in staff member's profile + membership (business, role,
// permissions) so every dashboard page knows who is acting, where, and what
// they may do. A signed-in user with no membership gets the create-shop step
// instead of a broken shell.
export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let access: StaffAccess = { profile: null, roleName: null, permissions: [] };
  let businessRow: Record<string, unknown> | null = null;

  if (user) {
    // Display-name profile; provisioned on first login (role-free — the role
    // lives on the membership since Sprint 32).
    let { data: profile } = await supabase
      .from("staff_profiles")
      .select("id, display_name")
      .eq("id", user.id)
      .maybeSingle();
    if (!profile) {
      const prefix = user.email?.split("@")[0] || "Staff";
      const display = prefix.charAt(0).toUpperCase() + prefix.slice(1);
      const { data: created } = await supabase
        .from("staff_profiles")
        .upsert(
          { id: user.id, display_name: display },
          { onConflict: "id", ignoreDuplicates: true },
        )
        .select("id, display_name")
        .maybeSingle();
      profile = created ?? { id: user.id, display_name: display };
    }

    // RLS shows the caller their whole business roster — filter to SELF or
    // maybeSingle() sees many rows and errors out.
    const { data: membershipRow } = await supabase
      .from("memberships")
      .select("business_id, roles(name, permissions), businesses(*)")
      .eq("user_id", user.id)
      .maybeSingle();
    const membership = membershipRow as MembershipRow | null;

    if (!membership) {
      return (
        <main className="min-h-screen flex items-center justify-center p-8 bg-muted">
          <div className="w-full max-w-md space-y-6">
            <div className="text-center space-y-1">
              <h1 className="font-heading text-2xl font-bold tracking-tight">
                Welcome, {profile.display_name}
              </h1>
              <p className="text-sm text-muted-foreground">
                Your login isn&apos;t part of a shop yet. Create your own below
                — or, if you&apos;re joining a team, ask the shop&apos;s owner
                to add you from their Team page.
              </p>
            </div>
            <CreateShopForm showSignOut />
          </div>
        </main>
      );
    }

    businessRow = membership.businesses;
    access = {
      profile: { id: profile.id, display_name: profile.display_name },
      roleName: membership.roles?.name ?? null,
      permissions: membership.roles?.permissions ?? [],
    };
  }

  // The Reports nav badge (Sprint 37) — only computed for someone who could
  // both see a proposal and act on it (same gate AgenticProposalPanel uses),
  // so no one sees a count promising an action they'd then be blocked from.
  const canSeeProposals =
    can(access.permissions, "reports") && can(access.permissions, "customers");
  const pendingProposalCount = canSeeProposals
    ? countPendingProposals((await loadFindings(supabase, businessRow)).findings)
    : 0;

  return (
    <DashboardShell
      access={access}
      brand={brandLine(withBusinessDefaults(businessRow))}
      rules={withRuleDefaults(businessRow)}
      loyalty={withLoyaltyDefaults(businessRow)}
      pendingProposalCount={pendingProposalCount}
    >
      {children}
    </DashboardShell>
  );
}
