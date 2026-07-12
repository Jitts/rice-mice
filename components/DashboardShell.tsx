"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { StaffProvider, type StaffProfile } from "@/components/StaffContext";

// --- tiny inline icon set (stroke style, inherits currentColor) ----------------

function Icon({ d, className = "h-5 w-5" }: { d: string; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`${className} shrink-0`}
      aria-hidden
    >
      {d.split("|").map((p, i) => (
        <path key={i} d={p} />
      ))}
    </svg>
  );
}

const ICONS = {
  menu: "M4 6h16|M4 12h16|M4 18h16",
  close: "M6 6l12 12|M18 6L6 18",
  collapse: "M11 17l-5-5 5-5|M18 17l-5-5 5-5",
  expand: "M13 17l5-5-5-5|M6 17l5-5-5-5",
  home: "M3 10.5L12 3l9 7.5|M5 9.75V21h14V9.75",
  receipt: "M6 3h12v18l-3-2-3 2-3-2-3 2V3z|M9 8h6|M9 12h6",
  tag: "M12 2H2v10l9.3 9.3a1 1 0 0 0 1.4 0l8.6-8.6a1 1 0 0 0 0-1.4L12 2z|M7 7h.01",
  users:
    "M12.5 8a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0|M2.5 20a6.5 6.5 0 0 1 13 0|M16 4.6a3.5 3.5 0 0 1 0 6.8|M17.5 14.4a6.5 6.5 0 0 1 4 5.6",
  megaphone: "M3 11l18-6v14L3 13v-2z|M11.6 16.8a3 3 0 1 1-5.8-1.6",
  book: "M4 19.5A2.5 2.5 0 0 1 6.5 17H20|M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z",
  user: "M15.5 7.5a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0|M5.5 20a6.5 6.5 0 0 1 13 0",
  logout: "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4|M16 17l5-5-5-5|M21 12H9",
};

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: ICONS.home, exact: true },
  { href: "/dashboard/orders", label: "Order pad", icon: ICONS.receipt },
  { href: "/dashboard/items", label: "Menu items", icon: ICONS.tag },
  { href: "/dashboard/segments", label: "Segments", icon: ICONS.users },
  { href: "/dashboard/campaigns", label: "Campaigns", icon: ICONS.megaphone },
];

const COLLAPSE_KEY = "rm-nav-collapsed";

export function DashboardShell({
  profile,
  children,
}: {
  profile: StaffProfile | null;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Restore the desktop rail preference after mount (avoids SSR mismatch).
  useEffect(() => {
    setCollapsed(localStorage.getItem(COLLAPSE_KEY) === "1");
  }, []);

  // Route change closes the mobile drawer.
  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  function toggleCollapsed() {
    setCollapsed((c) => {
      localStorage.setItem(COLLAPSE_KEY, c ? "0" : "1");
      return !c;
    });
  }

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  function isActive(item: (typeof NAV)[number]) {
    return item.exact
      ? pathname === item.href
      : pathname === item.href || pathname.startsWith(item.href + "/");
  }

  const navList = (showLabels: boolean) => (
    <nav className="flex-1 px-2 py-3 space-y-1">
      {NAV.map((item) => {
        const active = isActive(item);
        return (
          <Link
            key={item.href}
            href={item.href}
            title={item.label}
            className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
              active
                ? "bg-neutral-900 text-white"
                : "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900"
            } ${showLabels ? "" : "justify-center px-0"}`}
          >
            <Icon d={item.icon} />
            {showLabels && <span className="truncate">{item.label}</span>}
          </Link>
        );
      })}
    </nav>
  );

  const signOutButton = (showLabel: boolean) => {
    const glossaryActive = pathname === "/dashboard/glossary";
    const teamActive =
      pathname === "/dashboard/team" || pathname.startsWith("/dashboard/team/");
    return (
      <div className="border-t border-neutral-200 px-2 py-3 space-y-1">
        <Link
          href="/dashboard/team"
          title={
            profile
              ? `Signed in as ${profile.display_name} — team settings`
              : "Team settings"
          }
          className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium ${
            teamActive
              ? "bg-neutral-900 text-white"
              : "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900"
          } ${showLabel ? "" : "justify-center px-0"}`}
        >
          <Icon d={ICONS.user} />
          {showLabel && (
            <span className="truncate">{profile?.display_name ?? "Team"}</span>
          )}
        </Link>
        <Link
          href="/dashboard/glossary"
          title="Glossary — what every metric means"
          className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium ${
            glossaryActive
              ? "bg-neutral-900 text-white"
              : "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900"
          } ${showLabel ? "" : "justify-center px-0"}`}
        >
          <Icon d={ICONS.book} />
          {showLabel && <span>Glossary</span>}
        </Link>
        <button
          onClick={signOut}
          title="Sign out"
          className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900 ${
            showLabel ? "" : "justify-center px-0"
          }`}
        >
          <Icon d={ICONS.logout} />
          {showLabel && <span>Sign out</span>}
        </button>
      </div>
    );
  };

  return (
    <StaffProvider profile={profile}>
    <div className="min-h-screen bg-neutral-50">
      {/* Mobile top bar */}
      <header className="md:hidden sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-neutral-200 bg-white px-4">
        <button
          onClick={() => setDrawerOpen(true)}
          aria-label="Open menu"
          className="rounded-lg p-2 text-neutral-600 hover:bg-neutral-100"
        >
          <Icon d={ICONS.menu} />
        </button>
        <span className="font-semibold">🍚🐭 rice-mice</span>
      </header>

      {/* Mobile drawer + backdrop */}
      {drawerOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/30 md:hidden"
          onClick={() => setDrawerOpen(false)}
          aria-hidden
        />
      )}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-neutral-200 bg-white transition-transform duration-200 md:hidden ${
          drawerOpen ? "translate-x-0" : "-translate-x-full"
        }`}
        aria-label="Navigation"
      >
        <div className="flex h-14 items-center justify-between border-b border-neutral-200 px-4">
          <span className="font-semibold">🍚🐭 rice-mice</span>
          <button
            onClick={() => setDrawerOpen(false)}
            aria-label="Close menu"
            className="rounded-lg p-2 text-neutral-600 hover:bg-neutral-100"
          >
            <Icon d={ICONS.close} />
          </button>
        </div>
        {navList(true)}
        {signOutButton(true)}
      </aside>

      {/* Desktop sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-30 hidden flex-col border-r border-neutral-200 bg-white transition-all duration-200 md:flex ${
          collapsed ? "w-16" : "w-60"
        }`}
        aria-label="Navigation"
      >
        <div
          className={`flex h-14 items-center border-b border-neutral-200 ${
            collapsed ? "justify-center" : "justify-between px-4"
          }`}
        >
          {!collapsed && <span className="font-semibold whitespace-nowrap">🍚🐭 rice-mice</span>}
          <button
            onClick={toggleCollapsed}
            aria-label={collapsed ? "Expand menu" : "Collapse menu"}
            className="rounded-lg p-2 text-neutral-600 hover:bg-neutral-100"
          >
            <Icon d={collapsed ? ICONS.menu : ICONS.collapse} />
          </button>
        </div>
        {navList(!collapsed)}
        {signOutButton(!collapsed)}
      </aside>

      {/* Content */}
      <main
        className={`transition-all duration-200 ${collapsed ? "md:pl-16" : "md:pl-60"}`}
      >
        <div className="p-4 sm:p-6 lg:p-8">{children}</div>
      </main>
    </div>
    </StaffProvider>
  );
}
