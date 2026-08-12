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

// The same scan for `<adminHandle>.rpc("fn")`. Sprint 47 flagged this hole and
// Sprint 48 widened it: the scan above only understands `.from()`, so every
// service-role FUNCTION call was invisible to it. Those functions bypass RLS
// exactly like a table read does, and `merge_customers` is the sharpest case in
// the codebase — it is the only operation that repoints rows from one customer
// to another, so an unfenced call could pull a second tenant's rows onto a
// record here.
//
// The fence for these lives in an explicit business argument rather than a
// filter, by deliberate design (migration 0024): the id is passed in and the
// WHERE clause is written inside the function, so it cannot be inferred from a
// session. That makes the check "does this call pass p_business".
const TENANT_ARG = "p_business";

// Service-role functions that legitimately take no business argument. Empty,
// and adding to it should require an argument about why a function that
// bypasses RLS needs no tenant scope. `public_business_branding` is NOT here —
// it is called on the anon client, so it never matches an admin handle.
const UNSCOPED_FUNCTIONS = new Set<string>([]);

function adminRpcCalls(): Query[] {
  const found: Query[] = [];
  const pattern = new RegExp(
    `\\b(?:${ADMIN_HANDLES.join("|")})\\s*\\.rpc\\(\\s*["']([a-z_]+)["']`,
    "g",
  );

  for (const file of files) {
    const src = readFileSync(file, "utf8");
    if (!src.includes("createAdminClient")) continue;

    for (const match of src.matchAll(pattern)) {
      const start = match.index ?? 0;
      const semi = src.indexOf(";", start);
      found.push({
        file: file.slice(root.length + 1).replace(/\\/g, "/"),
        line: src.slice(0, start).split("\n").length,
        table: match[1], // the function name, in this scan
        statement: src.slice(start, semi === -1 ? start + 600 : semi),
      });
    }
  }
  return found;
}

describe("service-role tenant fence", () => {
  const queries = adminQueries();
  const rpcs = adminRpcCalls();

  it("finds the admin queries it is supposed to be guarding", () => {
    // A guard that silently matches nothing always passes. If a refactor
    // renames the admin handles, this fails loudly instead of going quiet.
    expect(queries.length).toBeGreaterThan(0);
    expect(queries.some((q) => TENANT_TABLES.has(q.table))).toBe(true);
  });

  it("finds the admin rpc calls it is supposed to be guarding", () => {
    // Same reasoning, and worth stating twice: this half of the scan was absent
    // entirely until Sprint 49, so "matches nothing" is its historical state.
    expect(rpcs.length).toBeGreaterThan(0);
  });

  it("passes a business id to every service-role function it calls", () => {
    const unscoped = rpcs
      .filter((q) => !UNSCOPED_FUNCTIONS.has(q.table))
      .filter((q) => !q.statement.includes(TENANT_ARG))
      .map((q) => `${q.file}:${q.line} — admin rpc "${q.table}" passes no ${TENANT_ARG}`);

    expect(unscoped).toEqual([]);
  });

  it("scopes every admin query on a tenant table by business_id", () => {
    const unscoped = queries
      .filter((q) => TENANT_TABLES.has(q.table))
      .filter((q) => !q.statement.includes("business_id"))
      .map((q) => `${q.file}:${q.line} — admin query on "${q.table}" has no business_id scope`);

    expect(unscoped).toEqual([]);
  });
});
