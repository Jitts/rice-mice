"use client";

import { createContext, useContext } from "react";
import { DEFAULT_RULES, type MarketingRules } from "@/lib/marketing";

// The marketing rules, resolved server-side in the dashboard layout (from the
// business_settings singleton) and provided to every dashboard client
// component — the journey ribbon, suggestions, attribution and glossary all
// read the SAME object, so a rules edit moves everything together.

const RulesContext = createContext<MarketingRules>(DEFAULT_RULES);

export function RulesProvider({
  rules,
  children,
}: {
  rules: MarketingRules;
  children: React.ReactNode;
}) {
  return <RulesContext.Provider value={rules}>{children}</RulesContext.Provider>;
}

export function useRules(): MarketingRules {
  return useContext(RulesContext);
}
