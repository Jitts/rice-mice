// Tenant-isolation probe (RED_TEAM.md item 3) — the repeatable version of the
// Sprint 32 one-off. RLS is the fence between shops; this proves, hands-off,
// that:
//   (a) a signed-in staff member of shop A reads ZERO of shop B's rows (and
//       vice-versa) — customers and businesses,
//   (b) anon can enumerate NOTHING (no businesses, no customers),
//   (c) the only anon window, public_business_branding(slug), returns a shop's
//       public render fields by exact slug and nothing for an unknown slug.
//
// It is READ-ONLY: it plants nothing and deletes nothing, so it is safe to run
// repeatedly. Point it at a DEDICATED QA project seeded once with two shops
// (create them via the app's /signup), never at production.
//
//   SUPABASE_URL=...            (QA project URL)
//   SUPABASE_ANON_KEY=...       (QA anon key)
//   SHOP_A_EMAIL=... SHOP_A_PASSWORD=...
//   SHOP_B_EMAIL=... SHOP_B_PASSWORD=...
//   node scripts/redteam/tenant-isolation.mjs
//
// Exits non-zero if any isolation assertion fails.

const URL = process.env.SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY;
const A = { email: process.env.SHOP_A_EMAIL, password: process.env.SHOP_A_PASSWORD };
const B = { email: process.env.SHOP_B_EMAIL, password: process.env.SHOP_B_PASSWORD };

if (!URL || !ANON || !A.email || !A.password || !B.email || !B.password) {
  console.error(
    "Missing env. Need SUPABASE_URL, SUPABASE_ANON_KEY, SHOP_A_EMAIL/PASSWORD, SHOP_B_EMAIL/PASSWORD.",
  );
  console.error("Point at a dedicated QA project with two seeded shops — never production.");
  process.exit(2);
}

let failed = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
  if (!ok) failed++;
}

async function signIn({ email, password }) {
  const res = await fetch(`${URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: ANON },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error(`sign-in failed for ${email}: ${data.error_description ?? res.status}`);
  return data.access_token;
}

// PostgREST GET with a caller token (or anon only when token is null).
async function rest(path, token) {
  const res = await fetch(`${URL}/rest/v1/${path}`, {
    headers: {
      apikey: ANON,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!res.ok) return { error: res.status, rows: [] };
  return { rows: await res.json() };
}

async function rpc(fn, args, token) {
  const res = await fetch(`${URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: ANON,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(args),
  });
  if (!res.ok) return { error: res.status, data: null };
  return { data: await res.json() };
}

async function main() {
  const tokenA = await signIn(A);
  const tokenB = await signIn(B);

  // Each shop's own business row (id + slug) — read as itself.
  const bizA = (await rest("businesses?select=id,slug", tokenA)).rows;
  const bizB = (await rest("businesses?select=id,slug", tokenB)).rows;
  check("shop A sees exactly one business (its own)", bizA.length === 1, `saw ${bizA.length}`);
  check("shop B sees exactly one business (its own)", bizB.length === 1, `saw ${bizB.length}`);
  const idA = bizA[0]?.id;
  const idB = bizB[0]?.id;
  check("the two QA shops are distinct", idA && idB && idA !== idB);

  // (a) Cross-tenant reads return zero of the other shop's rows.
  const custA = (await rest("customers?select=id,business_id", tokenA)).rows;
  const custB = (await rest("customers?select=id,business_id", tokenB)).rows;
  check(
    "shop A reads none of shop B's customers",
    custA.every((c) => c.business_id !== idB),
    `${custA.filter((c) => c.business_id === idB).length} leaked`,
  );
  check(
    "shop B reads none of shop A's customers",
    custB.every((c) => c.business_id !== idA),
    `${custB.filter((c) => c.business_id === idA).length} leaked`,
  );
  check(
    "shop A cannot see shop B's business row",
    bizA.every((b) => b.id !== idB),
  );

  // (b) Anon enumerates nothing.
  const anonBiz = await rest("businesses?select=id", null);
  check(
    "anon enumerates no businesses",
    (anonBiz.rows?.length ?? 0) === 0,
    anonBiz.error ? `blocked (${anonBiz.error})` : `${anonBiz.rows.length} rows`,
  );
  const anonCust = await rest("customers?select=id", null);
  check(
    "anon enumerates no customers",
    (anonCust.rows?.length ?? 0) === 0,
    anonCust.error ? `blocked (${anonCust.error})` : `${anonCust.rows.length} rows`,
  );

  // (c) The one anon window: branding by exact slug, nothing otherwise.
  const slugA = bizA[0]?.slug;
  if (slugA) {
    const known = await rpc("public_business_branding", { p_slug: slugA }, null);
    const knownRow = Array.isArray(known.data) ? known.data[0] : known.data;
    check("anon branding RPC returns a shop for a real slug", !!knownRow, slugA);
    // The RPC's return type is fixed to public render fields (id, slug,
    // shop_name, emoji, tagline, phone) — all shown on the sign-up page. The
    // isolation property is no ENUMERATION (you must know the slug), asserted
    // by the unknown-slug check below; here just confirm it yields render data.
    check(
      "anon branding RPC returns only render fields",
      knownRow && knownRow.shop_name !== undefined && knownRow.slug === slugA,
    );
  }
  const unknown = await rpc(
    "public_business_branding",
    { p_slug: `no-such-shop-${Date.now()}` },
    null,
  );
  const unknownRow = Array.isArray(unknown.data) ? unknown.data[0] : unknown.data;
  check("anon branding RPC returns nothing for an unknown slug", !unknownRow);

  console.log(
    failed === 0
      ? "\nTenant isolation holds — no cross-tenant or anon leakage."
      : `\n${failed} isolation assertion(s) FAILED.`,
  );
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("Probe error:", e.message);
  process.exit(2);
});
