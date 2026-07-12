// The permission catalog. It is FIXED in code on purpose: a permission is
// only real if code somewhere enforces it, so inventing permissions at
// runtime would create checkboxes that do nothing. Owners compose these
// into their own named roles (Settings → Roles & permissions).

export const OWNER_ROLE_ID = "c0000000-0000-0000-0000-000000000001";
export const STAFF_ROLE_ID = "c0000000-0000-0000-0000-000000000002";

// "*" in a role's permission list means everything, including permissions
// added in future sprints. Only the system Owner role uses it.
export const ALL = "*";

export type PermissionDef = {
  id: string;
  label: string;
  description: string;
};

export const PERMISSIONS: PermissionDef[] = [
  {
    id: "orders",
    label: "Order pad",
    description: "Place orders, advance the kitchen flow, edit lines, print receipts.",
  },
  {
    id: "menu",
    label: "Menu items",
    description: "Add, edit and deactivate menu items and prices.",
  },
  {
    id: "customers",
    label: "Customer data",
    description: "Edit customer tags, custom fields and contact details on the dashboard.",
  },
  {
    id: "segments",
    label: "Segments",
    description: "Build and save audience segments and custom criteria.",
  },
  {
    id: "campaigns",
    label: "Campaigns & journeys",
    description: "Compose campaigns, design journeys, launch them, and send messages.",
  },
  {
    id: "reports",
    label: "Reports",
    description: "See sales reports and export order CSVs.",
  },
  {
    id: "settings_business",
    label: "Business settings",
    description: "Edit the shop identity shown on the sign-up page and receipts.",
  },
  {
    id: "team",
    label: "Team accounts",
    description: "Create staff accounts, reset passwords, deactivate logins, assign roles.",
  },
  {
    id: "roles",
    label: "Roles & permissions",
    description: "Create and edit the roles staff can be assigned to.",
  },
  {
    id: "providers",
    label: "Channel providers",
    description: "Connect and manage WhatsApp / email / SMS provider keys.",
  },
];

export const PERMISSIONS_BY_ID: Record<string, PermissionDef> = Object.fromEntries(
  PERMISSIONS.map((p) => [p.id, p]),
);

export function can(
  perms: readonly string[] | null | undefined,
  id: string,
): boolean {
  if (!perms) return false;
  return perms.includes(ALL) || perms.includes(id);
}

export type RoleRow = {
  id: string;
  name: string;
  description: string | null;
  permissions: string[];
  is_system: boolean;
};
