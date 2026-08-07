import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// Red-team gate item 3 (tenant isolation) — the half that can run in CI.
//
// Isolation has two independent fences, and they fail in different ways:
//
//  1. RLS, for anon + signed-in callers. Enforced by the database, so proving
//     it needs a live database — that stays in scripts/redteam/tenant-isolation.mjs
//     against a seeded QA project.
//  2. The service-role client, which **bypasses RLS completely**. Nothing in
//     the database protects this path; the ONLY fence is an explicit
//     business_id scope written in the query itself. That is a property of
//     the source code, so it is testable here — with no database, no secrets
//     and no network.
//
// This file guards fence 2, which is the one that regresses silently: someone
// adds a new admin query, forgets `.eq("business_id", …)`, every test still
// passes, and one shop can read another's rows. See docs/DECISIONS.md Q4
// ("Where does the service-role boundary move?").

// Tables carrying business_id — the backfill loop in 0017_multi_tenant.sql
// plus the tables that declare it directly (memberships, roles,
// channel_providers, audit_log, and import_batches from 0022). A query the
// admin client makes against any of these must say which business it means.
const TENANT_TABLES = new Set([
  "customers",
  "signup_events",
  "engagement_logs",
  "items",
  "orders",
  "order_items",
  "segments",
  "campaigns",
  "custom_fields",
  "journeys",
  "journey_runs",
  "journey_actions",
  "rewards",
  "memberships",
  "roles",
  "channel_providers",
  "audit_log",
  "import_batches",
]);

// Handles bound to a service-role client in this codebase: `const admin =
// createAdminClient()` and `const api = admin()` (the local helper in
// app/actions/*). Deliberately a fixed list rather than inference — if a new
// name appears it should be added here consciously, since the whole point is
// that these bypass RLS.
const ADMIN_HANDLES = ["admin", "api"];

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

const root = join(__dirname, "..");
const files = [...sourceFiles(join(root, "app")), ...sourceFiles(join(root, "lib"))];

type Query = { file: string; line: number; table: string; statement: string };

// Every `<adminHandle>.from("table")` in a file that imports createAdminClient,
// paired with the statement it belongs to (up to the terminating semicolon).
function adminQueries(): Query[] {
  const found: Query[] = [];
  const pattern = new RegExp(
    `\\b(?:${ADMIN_HANDLES.join("|")})\\s*\\.from\\(\\s*["']([a-z_]+)["']`,
    "g",
  );

  for (const file of files) {
    const src = readFileSync(file, "utf8");
    if (!src.includes("createAdminClient")) continue; // no service-role client here

    for (const match of src.matchAll(pattern)) {
      const start = match.index ?? 0;
      const semi = src.indexOf(";", start);
      const statement = src.slice(start, semi === -1 ? start + 600 : semi);
      found.push({
        file: file.slice(root.length + 1).replace(/\\/g, "/"),
        line: src.slice(0, start).split("\n").length,
        table: match[1],
        statement,
      });
    }
  }
  return found;
}

describe("service-role tenant fence", () => {
  const queries = adminQueries();

  it("finds the admin queries it is supposed to be guarding", () => {
    // A guard that silently matches nothing always passes. If a refactor
    // renames the admin handles, this fails loudly instead of going quiet.
    expect(queries.length).toBeGreaterThan(0);
    expect(queries.some((q) => TENANT_TABLES.has(q.table))).toBe(true);
  });

  it("scopes every admin query on a tenant table by business_id", () => {
    const unscoped = queries
      .filter((q) => TENANT_TABLES.has(q.table))
      .filter((q) => !q.statement.includes("business_id"))
      .map((q) => `${q.file}:${q.line} — admin query on "${q.table}" has no business_id scope`);

    expect(unscoped).toEqual([]);
  });
});
