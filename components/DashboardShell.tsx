"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { can } from "@/lib/permissions";
import { StaffProvider, type StaffAccess } from "@/components/StaffContext";
import { LoyaltyProvider, RulesProvider } from "@/components/RulesContext";
import { DEFAULT_RULES, type MarketingRules } from "@/lib/marketing";
import { DEFAULT_LOYALTY, type LoyaltyConfig } from "@/lib/loyalty";

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
  chart: "M4 20V10|M10 20V4|M16 20v-8|M22 20H2",
  user: "M15.5 7.5a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0|M5.5 20a6.5 6.5 0 0 1 13 0",
  logout: "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4|M16 17l5-5-5-5|M21 12H9",
  moon: "M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z",
  sun: "M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10z|M12 3v1.5|M12 19.5V21|M3 12h1.5|M19.5 12H21|M5.6 5.6l1.1 1.1|M17.3 17.3l1.1 1.1|M18.4 5.6l-1.1 1.1|M6.7 17.3l-1.1 1.1",
};

const THEME_KEY = "rm-theme";

// perm: which catalog permission unlocks the item; undefined = always shown.
const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: ICONS.home, exact: true, perm: undefined },
  { href: "/dashboard/orders", label: "Order pad", icon: ICONS.receipt, perm: "orders" },
  { href: "/dashboard/items", label: "Menu items", icon: ICONS.tag, perm: "menu" },
  { href: "/dashboard/segments", label: "Segments", icon: ICONS.users, perm: "segments" },
  { href: "/dashboard/campaigns", label: "Campaigns", icon: ICONS.megaphone, perm: "campaigns" },
  { href: "/dashboard/reports", label: "Reports", icon: ICONS.chart, perm: "reports" },
];

const COLLAPSE_KEY = "rm-nav-collapsed";

export function DashboardShell({
  access,
  brand = "🍚🐭 rice-mice",
  rules = DEFAULT_RULES,
  loyalty = DEFAULT_LOYALTY,
  children,
}: {
  access: StaffAccess;
  brand?: string;
  rules?: MarketingRules;
  loyalty?: LoyaltyConfig;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const profile = access.profile;
  const visibleNav = NAV.filter(
    (item) => !item.perm || can(access.permissions, item.perm),
  );

  // Restore the desktop rail preference after mount (avoids SSR mismatch).
  // Theme: the root layout's inline script already applied the saved class
  // before paint — here we just sync the label state to it.
  useEffect(() => {
    setCollapsed(localStorage.getItem(COLLAPSE_KEY) === "1");
    setTheme(
      document.documentElement.classList.contains("dark") ? "dark" : "light",
    );
  }, []);

  function toggleTheme() {
    const next = theme === "dark" ? "light" : "dark";
    document.documentElement.classList.toggle("dark", next === "dark");
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {}
    setTheme(next);
  }

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
      {visibleNav.map((item) => {
        const active = isActive(item);
        return (
          <Link
            key={item.href}
            href={item.href}
            title={item.label}
            className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
              active
                ? "bg-sidebar-primary text-sidebar-primary-foreground"
                : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
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
    const settingsActive =
      pathname === "/dashboard/settings" ||
      pathname.startsWith("/dashboard/settings/") ||
      pathname === "/dashboard/team" ||
      pathname.startsWith("/dashboard/team/");
    return (
      <div className="border-t border-sidebar-border px-2 py-3 space-y-1">
        <Link
          href="/dashboard/settings"
          title={
            profile
              ? `Signed in as ${profile.display_name} — settings`
              : "Settings"
          }
          className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium ${
            settingsActive
              ? "bg-sidebar-primary text-sidebar-primary-foreground"
              : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          } ${showLabel ? "" : "justify-center px-0"}`}
        >
          <Icon d={ICONS.user} />
          {showLabel && (
            <span className="truncate">{profile?.display_name ?? "Settings"}</span>
          )}
        </Link>
        <Link
          href="/dashboard/glossary"
          title="Glossary — what every metric means"
          className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium ${
            glossaryActive
              ? "bg-sidebar-primary text-sidebar-primary-foreground"
              : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          } ${showLabel ? "" : "justify-center px-0"}`}
        >
          <Icon d={ICONS.book} />
          {showLabel && <span>Glossary</span>}
        </Link>
        <button
          onClick={toggleTheme}
          title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground ${
            showLabel ? "" : "justify-center px-0"
          }`}
        >
          <Icon d={theme === "dark" ? ICONS.sun : ICONS.moon} />
          {showLabel && <span>{theme === "dark" ? "Light mode" : "Dark mode"}</span>}
        </button>
        <button
          onClick={signOut}
          title="Sign out"
          className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground ${
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
    <StaffProvider access={access}>
    <RulesProvider rules={rules}>
    <LoyaltyProvider config={loyalty}>
    <div className="min-h-screen bg-muted">
      {/* Mobile top bar */}
      <header className="md:hidden sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-card px-4">
        <button
          onClick={() => setDrawerOpen(true)}
          aria-label="Open menu"
          className="rounded-lg p-2 text-muted-foreground hover:bg-muted"
        >
          <Icon d={ICONS.menu} />
        </button>
        <span className="font-heading font-semibold">{brand}</span>
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
        className={`fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-transform duration-200 md:hidden ${
          drawerOpen ? "translate-x-0" : "-translate-x-full"
        }`}
        aria-label="Navigation"
      >
        <div className="flex h-14 items-center justify-between border-b border-sidebar-border px-4">
          <span className="font-heading font-semibold">{brand}</span>
          <button
            onClick={() => setDrawerOpen(false)}
            aria-label="Close menu"
            className="rounded-lg p-2 text-muted-foreground hover:bg-muted"
          >
            <Icon d={ICONS.close} />
          </button>
        </div>
        {navList(true)}
        {signOutButton(true)}
      </aside>

      {/* Desktop sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-30 hidden flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-all duration-200 md:flex ${
          collapsed ? "w-16" : "w-60"
        }`}
        aria-label="Navigation"
      >
        <div
          className={`flex h-14 items-center border-b border-sidebar-border ${
            collapsed ? "justify-center" : "justify-between px-4"
          }`}
        >
          {!collapsed && <span className="font-heading font-semibold whitespace-nowrap">{brand}</span>}
          <button
            onClick={toggleCollapsed}
            aria-label={collapsed ? "Expand menu" : "Collapse menu"}
            className="rounded-lg p-2 text-muted-foreground hover:bg-muted"
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
    </LoyaltyProvider>
    </RulesProvider>
    </StaffProvider>
  );
}
