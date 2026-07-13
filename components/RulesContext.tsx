"use client";

import { createContext, useContext } from "react";
import { DEFAULT_RULES, type MarketingRules } from "@/lib/marketing";
import { DEFAULT_LOYALTY, type LoyaltyConfig } from "@/lib/loyalty";

// The marketing rules and loyalty earning criteria, resolved server-side in
// the dashboard layout (from the business_settings singleton) and provided to
// every dashboard client component — the journey ribbon, suggestions,
// attribution, glossary and loyalty displays all read the SAME objects, so a
// Settings edit moves everything together.

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

const LoyaltyContext = createContext<LoyaltyConfig>(DEFAULT_LOYALTY);

export function LoyaltyProvider({
  config,
  children,
}: {
  config: LoyaltyConfig;
  children: React.ReactNode;
}) {
  return (
    <LoyaltyContext.Provider value={config}>{children}</LoyaltyContext.Provider>
  );
}

export function useLoyalty(): LoyaltyConfig {
  return useContext(LoyaltyContext);
}
