import type { PlannerMode, PlannerPlan } from "@/lib/plannerAgent";

// One conversation shared across Reports, Segments, and Campaigns — asking
// the analyst something on Reports and then asking the assistant to act on
// it elsewhere shouldn't require repeating yourself. sessionStorage (not
// localStorage) so it clears with the tab, like a real conversation would.

export type AssistantExchange = { id: string; question: string } & (
  | { kind: "analyst"; answer: string }
  | { kind: "planner"; mode: PlannerMode; plan: PlannerPlan }
);

const STORAGE_KEY = "rice-mice.assistantThread";
const MAX_STORED = 30;

export function loadThread(): AssistantExchange[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveThread(exchanges: AssistantExchange[]) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(exchanges.slice(-MAX_STORED)));
  } catch {
    // Private mode / storage disabled — conversation just won't survive a
    // page navigation.
  }
}

// Flattens past exchanges into the {role, content} shape both the analyst and
// planner server actions take as history — a planner turn's content is the
// plan JSON, matching what each backend already expects from its own prior
// turns, so a question on one page can reference an answer or plan from
// another.
export function threadHistory(
  exchanges: AssistantExchange[],
): { role: "user" | "assistant"; content: string }[] {
  return exchanges.flatMap((e) => [
    { role: "user" as const, content: e.question },
    {
      role: "assistant" as const,
      content: e.kind === "analyst" ? e.answer : JSON.stringify(e.plan),
    },
  ]);
}
