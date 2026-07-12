"use client";

import { createContext, useContext } from "react";

// The signed-in staff member's profile, resolved server-side in the dashboard
// layout and provided to every dashboard client component. Null only when the
// profile couldn't be resolved (unauthenticated edge; middleware normally
// redirects those to /login before this renders).

export type StaffProfile = {
  id: string;
  display_name: string;
};

const StaffContext = createContext<StaffProfile | null>(null);

export function StaffProvider({
  profile,
  children,
}: {
  profile: StaffProfile | null;
  children: React.ReactNode;
}) {
  return <StaffContext.Provider value={profile}>{children}</StaffContext.Provider>;
}

export function useStaff(): StaffProfile | null {
  return useContext(StaffContext);
}
