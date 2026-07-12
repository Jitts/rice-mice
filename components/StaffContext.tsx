"use client";

import { createContext, useContext } from "react";
import { can } from "@/lib/permissions";

// The signed-in staff member's identity AND what their role lets them do,
// resolved server-side in the dashboard layout. Null profile / empty
// permissions only when unresolved (middleware normally redirects first).
// A profile with no role has NO permissions — deny by default.

export type StaffProfile = {
  id: string;
  display_name: string;
};

export type StaffAccess = {
  profile: StaffProfile | null;
  roleName: string | null;
  permissions: string[];
};

const EMPTY_ACCESS: StaffAccess = { profile: null, roleName: null, permissions: [] };

const StaffContext = createContext<StaffAccess>(EMPTY_ACCESS);

export function StaffProvider({
  access,
  children,
}: {
  access: StaffAccess;
  children: React.ReactNode;
}) {
  return <StaffContext.Provider value={access}>{children}</StaffContext.Provider>;
}

export function useAccess(): StaffAccess {
  return useContext(StaffContext);
}

export function useCan(permission: string): boolean {
  return can(useContext(StaffContext).permissions, permission);
}

// Back-compat: components that only need the identity (order pad,
// campaign run, action inbox) keep their original hook.
export function useStaff(): StaffProfile | null {
  return useContext(StaffContext).profile;
}
