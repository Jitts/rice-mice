// Sprint 53 — the pure half of the WhatsApp receipts webhook. Kept out of the
// route so the signature check can be tested; it is the only thing standing
// between the open internet and "mark these messages read".

import { createHmac, timingSafeEqual } from "crypto";

export type StatusEntry = {
  id?: string;
  status?: string;
  timestamp?: string;
  errors?: { title?: string; message?: string }[];
};

type Envelope = {
  entry?: {
    changes?: {
      value?: { metadata?: { phone_number_id?: string }; statuses?: StatusEntry[] };
    }[];
  }[];
};

export function signatureMatches(raw: string, header: string, secret: string): boolean {
  if (!header || !secret) return false;
  const expected = `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  // timingSafeEqual throws on a length mismatch rather than returning false.
  return a.length === b.length && timingSafeEqual(a, b);
}

export function firstPhoneNumberId(payload: unknown): string | null {
  for (const e of (payload as Envelope)?.entry ?? [])
    for (const c of e.changes ?? []) {
      const id = c.value?.metadata?.phone_number_id;
      if (typeof id === "string" && id.trim()) return id.trim();
    }
  return null;
}

export function collectStatuses(payload: unknown): StatusEntry[] {
  const out: StatusEntry[] = [];
  for (const e of (payload as Envelope)?.entry ?? [])
    for (const c of e.changes ?? []) out.push(...(c.value?.statuses ?? []));
  return out;
}

// Meta sends seconds. A missing or junk value falls back to now() rather than
// writing null, which would leave the column looking un-received.
export function tsToIso(ts: string | undefined): string {
  const n = Number(ts);
  return Number.isFinite(n) && n > 0
    ? new Date(n * 1000).toISOString()
    : new Date().toISOString();
}

/**
 * The single column one status writes, or null for a status we don't record.
 *
 * `read` deliberately does NOT backfill `delivered_at`. WhatsApp cannot be read
 * without being delivered, so inventing the earlier timestamp would look
 * reasonable — and it would be a number we were never told, which is the exact
 * species of plausible-but-fabricated figure this codebase keeps finding. If
 * the delivered callback is lost, the truth is that we never heard it.
 */
export function patchFor(
  s: StatusEntry,
): { column: string; patch: Record<string, string> } | null {
  if (!s.id || !s.status) return null;
  const at = tsToIso(s.timestamp);
  if (s.status === "delivered") return { column: "delivered_at", patch: { delivered_at: at } };
  if (s.status === "read") return { column: "read_at", patch: { read_at: at } };
  if (s.status === "failed")
    return {
      column: "failed_at",
      patch: {
        failed_at: at,
        failure_reason:
          s.errors?.[0]?.message ?? s.errors?.[0]?.title ?? "Delivery failed",
      },
    };
  return null; // "sent" — we stamped that ourselves at send time
}
