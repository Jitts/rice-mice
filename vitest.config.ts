import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Minimal setup: resolve the "@/" alias the app uses so tests can import the
// real modules, and only pick up files under tests/. These are the red-team
// regression suites (RED_TEAM.md items 1 & 5) — pure, deterministic, no network
// or DB — so they can run on every change.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});
