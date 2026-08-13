#!/usr/bin/env bash
#
# Sprint 50 — dump what tests/profileAggregate.parity.test.ts needs to prove
# that migration 0026's customer_profile_aggregate agrees with buildProfiles.
#
# Reads production. Writes three files to scripts/sprint50/dump/, which is
# gitignored because they contain real customer names, phones and emails.
# Delete them when you are done: `rm -rf scripts/sprint50/dump`.
#
# Run from the repo root:  bash scripts/sprint50/dump-parity-data.sh
#
# The service-role key is read from .env.local and never printed.

set -euo pipefail

cd "$(dirname "$0")/../.."
[ -f .env.local ] || { echo "no .env.local in $(pwd)" >&2; exit 1; }

set -a; . ./.env.local; set +a
: "${NEXT_PUBLIC_SUPABASE_URL:?}" "${SUPABASE_SERVICE_ROLE_KEY:?}"

OUT=scripts/sprint50/dump
mkdir -p "$OUT"

AUTH=(-H "apikey: $SUPABASE_SERVICE_ROLE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY")

# Every read below is checked for truncation. A short dump would make the parity
# test compare two partial sets and pass — the precise failure Sprint 49 exists
# to prevent, so the harness must not reproduce it.
fetch() {
  local name="$1" url="$2" body="${3:-}"
  local hdr="$OUT/.$name.hdr"
  if [ -n "$body" ]; then
    curl -sS -o "$OUT/$name.json" -D "$hdr" -X POST "$url" "${AUTH[@]}" \
      -H "Content-Type: application/json" -H "Prefer: count=exact" -d "$body"
  else
    curl -sS -o "$OUT/$name.json" -D "$hdr" "$url" "${AUTH[@]}" -H "Prefer: count=exact"
  fi

  local range total got
  range=$(grep -i '^content-range:' "$hdr" | tr -d '\r' | awk '{print $2}')
  rm -f "$hdr"
  total=${range##*/}
  got=${range%%/*}
  if [ "$got" = "*" ]; then got=0; else got=$(( ${got##*-} + 1 )); fi

  if [ "$got" != "$total" ]; then
    echo "TRUNCATED: $name returned $got of $total rows." >&2
    echo "Raise 'Max rows' in the Supabase Data API settings and run again —" >&2
    echo "a partial dump would make the parity test pass without comparing anything." >&2
    exit 1
  fi
  echo "  $name: $total rows"
}

BIZ=$(curl -sS "$NEXT_PUBLIC_SUPABASE_URL/rest/v1/businesses?select=id&limit=1" "${AUTH[@]}" \
      | grep -o '[0-9a-f-]\{36\}' | head -1)
[ -n "$BIZ" ] || { echo "could not read a business id" >&2; exit 1; }

echo "dumping for business $BIZ"

# Exactly what the pages pass to buildProfiles today (app/dashboard/segments/page.tsx:13-14).
fetch customers "$NEXT_PUBLIC_SUPABASE_URL/rest/v1/customers?select=*&business_id=eq.$BIZ"
fetch orders    "$NEXT_PUBLIC_SUPABASE_URL/rest/v1/orders?select=*,order_items(*)&business_id=eq.$BIZ"
fetch aggregate "$NEXT_PUBLIC_SUPABASE_URL/rest/v1/rpc/customer_profile_aggregate" "{\"p_business\":\"$BIZ\"}"

echo
echo "wrote $OUT — now run: npm test -- profileAggregate"
echo "delete it afterwards: rm -rf $OUT"
