// Sprint 53 — Meta's delivery and read callbacks for WhatsApp campaign sends.
//
// This endpoint is PUBLIC and it writes to engagement data, so the only thing
// standing between the open internet and "mark these messages read" is the
// signature check below. Everything here is written on the assumption that the
// body is hostile until proven otherwise.
//
// The awkward part, stated plainly: we have to parse the body to know WHICH
// shop it belongs to (the phone number id is inside it) before we can look up
// the secret that verifies it. So the body is parsed for routing only, nothing
// from it is trusted or written until the HMAC matches, and a body that names
// a phone number id we don't recognise is refused without touching the
// database.

import { createAdminClient } from "@/lib/supabase/admin";
import {
  collectStatuses,
  firstPhoneNumberId,
  patchFor,
  signatureMatches,
} from "@/lib/whatsappReceipts";

// timingSafeEqual and createHmac are Node APIs, not Edge ones.
export const runtime = "nodejs";

// Meta retries on any non-2xx, including ones that would never succeed. A
// refusal we mean (bad signature, unknown shop) still answers 200 with a body
// saying so — retrying it a hundred times helps nobody. Genuine server errors
// return 500, because those are worth retrying.
const ok = (detail: string) => Response.json({ ok: true, detail });

// --- GET: the subscription handshake ----------------------------------------
//
// The token lives per-shop in channel_providers, not in an env var. The
// handshake carries no phone number id, so there is nothing to route on — we
// ask whether ANY shop has claimed the presented token. That is the same check
// either way, and it keeps every WhatsApp credential in one place instead of
// splitting them between Settings and the environment (where a change also
// needs a redeploy before Meta's verification call can succeed).
//
// This token only gates the subscription handshake. It grants nothing: every
// actual callback is verified by HMAC against the shop's app secret below.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const presented = url.searchParams.get("hub.verify_token");
  if (url.searchParams.get("hub.mode") !== "subscribe" || !presented)
    return new Response("Forbidden", { status: 403 });

  const admin = createAdminClient();
  if (!admin) return new Response("Admin client unavailable", { status: 500 });
  const { data, error } = await admin
    .from("channel_providers")
    .select("id")
    .eq("id", "whatsapp")
    .eq("config->>webhook_verify_token", presented)
    .limit(1);
  if (error) return new Response("Lookup failed", { status: 500 });
  if (!data?.length) return new Response("Forbidden", { status: 403 });

  return new Response(url.searchParams.get("hub.challenge") ?? "", { status: 200 });
}

// --- POST: status callbacks -------------------------------------------------
export async function POST(req: Request) {
  // Raw text, not req.json(): the signature covers the exact bytes Meta sent,
  // and re-serialising a parsed object will not reproduce them.
  const raw = await req.text();
  const signature = req.headers.get("x-hub-signature-256");
  if (!signature) return ok("no signature");

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return ok("unparseable");
  }

  const phoneNumberId = firstPhoneNumberId(payload);
  if (!phoneNumberId) return ok("no phone number id");

  const admin = createAdminClient();
  if (!admin) return new Response("Admin client unavailable", { status: 500 });

  // Which shop owns this number, and what secret signs its callbacks.
  const { data: providerRow, error: lookupError } = await admin
    .from("channel_providers")
    .select("business_id, config")
    .eq("id", "whatsapp")
    .eq("config->>phone_number_id", phoneNumberId)
    .maybeSingle();
  if (lookupError) return new Response("Lookup failed", { status: 500 });
  if (!providerRow) return ok("unknown phone number id");

  const config = (providerRow.config ?? {}) as Record<string, unknown>;
  const appSecret = typeof config.app_secret === "string" ? config.app_secret.trim() : "";
  // No secret stored means the shop hasn't finished setting receipts up. We
  // cannot verify, so we do not write. Silently accepting here would make the
  // signature check optional for anyone who simply left the field blank.
  if (!appSecret) return ok("no app secret configured");

  if (!signatureMatches(raw, signature, appSecret)) return ok("bad signature");

  const statuses = collectStatuses(payload);
  if (statuses.length === 0) return ok("no statuses");

  let applied = 0;
  for (const s of statuses) {
    // Callbacks arrive repeatedly and out of order, so each status writes only
    // its own column, and only when that column is still empty.
    const resolved = patchFor(s);
    if (!resolved) continue;
    const { column, patch } = resolved;

    const { error } = await admin
      .from("engagement_logs")
      .update(patch)
      .eq("provider_message_id", s.id)
      // The tenant fence: a crafted callback naming another shop's wamid can't
      // reach it, because this business_id came from the row whose secret just
      // verified the signature.
      .eq("business_id", providerRow.business_id)
      .is(column, null);
    if (!error) applied += 1;
  }

  return ok(`applied ${applied}`);
}
