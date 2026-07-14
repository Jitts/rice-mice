// Version A of "bring your model": the PLATFORM holds one provider key (in the
// server environment), and each business picks which model the read-only
// analyst runs on from a curated list. No tenant ever supplies a key — so this
// module stores no secrets, only a model id (persisted on businesses.analyst_model).
//
// The active provider is chosen server-side by RICE_ANALYST_PROVIDER (default
// "gemini", because its free tier is what we run on today). Anthropic stays
// wired so the platform default can flip back with an env var alone.
//
// Import this from SERVER code only (it reads process.env). The Settings client
// receives the model list as plain props and imports just the ModelOption type.

export type AnalystProvider = "gemini" | "anthropic";

export type ModelOption = {
  id: string;
  label: string;
  hint: string;
};

// Curated, vetted lists — a business can only pick a model we've stood behind,
// which keeps the "every number has receipts" quality bar under our control
// (the reason we chose model-selection over full bring-your-own-key).
const CATALOG: Record<AnalystProvider, ModelOption[]> = {
  // Use the "-latest" aliases so Google retiring a dated model (as it did with
  // gemini-2.5-*, which 404s for new keys) doesn't break us again. Flash tiers
  // only — pro is quota-exhausted on the free tier. Verified working on a fresh
  // AI Studio key 2026-07-14.
  gemini: [
    {
      id: "gemini-flash-lite-latest",
      label: "Gemini Flash-Lite",
      hint: "Fastest and cheapest — the default, free-tier friendly",
    },
    {
      id: "gemini-flash-latest",
      label: "Gemini Flash",
      hint: "Deeper answers, a little slower",
    },
  ],
  anthropic: [
    {
      id: "claude-opus-4-8",
      label: "Claude Opus 4.8",
      hint: "Deepest reasoning",
    },
    {
      id: "claude-sonnet-5",
      label: "Claude Sonnet 5",
      hint: "Balanced speed and depth",
    },
    {
      id: "claude-haiku-4-5-20251001",
      label: "Claude Haiku 4.5",
      hint: "Fast and cheap",
    },
  ],
};

const PROVIDER_LABEL: Record<AnalystProvider, string> = {
  gemini: "Google Gemini",
  anthropic: "Anthropic Claude",
};

const KEY_ENV: Record<AnalystProvider, string> = {
  gemini: "GEMINI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
};

export const ANALYST_PROVIDER: AnalystProvider =
  process.env.RICE_ANALYST_PROVIDER === "anthropic" ? "anthropic" : "gemini";

export function analystModels(): ModelOption[] {
  return CATALOG[ANALYST_PROVIDER];
}

export function defaultAnalystModel(): string {
  return CATALOG[ANALYST_PROVIDER][0].id;
}

// A stored id from a different provider (e.g. after flipping RICE_ANALYST_PROVIDER)
// silently falls back to the active provider's default rather than erroring.
export function resolveAnalystModel(stored: string | null | undefined): string {
  const list = CATALOG[ANALYST_PROVIDER];
  return list.find((m) => m.id === stored)?.id ?? list[0].id;
}

export function analystProviderLabel(): string {
  return PROVIDER_LABEL[ANALYST_PROVIDER];
}

export function analystKeyEnvName(): string {
  return KEY_ENV[ANALYST_PROVIDER];
}

// Static references so Next.js can inline them; only ever read server-side.
export function analystKeyPresent(): boolean {
  return ANALYST_PROVIDER === "anthropic"
    ? !!process.env.ANTHROPIC_API_KEY
    : !!process.env.GEMINI_API_KEY;
}
