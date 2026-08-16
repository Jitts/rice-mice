import { describe, it, expect } from "vitest";
import { createHmac } from "crypto";
import {
  collectStatuses,
  firstPhoneNumberId,
  patchFor,
  signatureMatches,
  tsToIso,
} from "@/lib/whatsappReceipts";

// Sprint 53. This endpoint is public and writes to engagement data, so the
// signature check is the security boundary — it gets tested first and hardest.

const SECRET = "app-secret-value";
const sign = (raw: string, secret = SECRET) =>
  `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`;

const envelope = (statuses: unknown[], phoneNumberId = "1347208058466404") => ({
  object: "whatsapp_business_account",
  entry: [
    {
      id: "waba-1",
      changes: [
        {
          field: "messages",
          value: {
            messaging_product: "whatsapp",
            metadata: { display_phone_number: "1555", phone_number_id: phoneNumberId },
            statuses,
          },
        },
      ],
    },
  ],
});

describe("signatureMatches", () => {
  const raw = JSON.stringify(envelope([]));

  it("accepts a body signed with the shop's secret", () => {
    expect(signatureMatches(raw, sign(raw), SECRET)).toBe(true);
  });

  it("rejects a body signed with a different secret", () => {
    expect(signatureMatches(raw, sign(raw, "someone-elses-secret"), SECRET)).toBe(false);
  });

  it("rejects when the body was altered after signing", () => {
    const header = sign(raw);
    const tampered = raw.replace("1347208058466404", "9999999999999999");
    expect(signatureMatches(tampered, header, SECRET)).toBe(false);
  });

  it("rejects an empty or missing header without throwing", () => {
    // timingSafeEqual throws on a length mismatch, so a short header must be
    // handled before it gets there.
    expect(signatureMatches(raw, "", SECRET)).toBe(false);
    expect(signatureMatches(raw, "sha256=abc", SECRET)).toBe(false);
  });

  it("rejects when no secret is configured", () => {
    // Otherwise leaving the field blank would silently make signing optional.
    expect(signatureMatches(raw, sign(raw), "")).toBe(false);
  });
});

describe("payload reading", () => {
  it("finds the phone number id that routes the callback to a shop", () => {
    expect(firstPhoneNumberId(envelope([]))).toBe("1347208058466404");
  });

  it("returns null rather than guessing when the shape is wrong", () => {
    expect(firstPhoneNumberId({})).toBeNull();
    expect(firstPhoneNumberId(null)).toBeNull();
    expect(firstPhoneNumberId({ entry: [{ changes: [{ value: {} }] }] })).toBeNull();
  });

  it("collects statuses across entries and changes", () => {
    const payload = {
      entry: [
        { changes: [{ value: { statuses: [{ id: "a" }] } }] },
        { changes: [{ value: { statuses: [{ id: "b" }, { id: "c" }] } }] },
      ],
    };
    expect(collectStatuses(payload).map((s) => s.id)).toEqual(["a", "b", "c"]);
  });

  it("treats a message-only callback as having no statuses", () => {
    // An inbound customer message arrives on the same subscription.
    expect(collectStatuses(envelope([]))).toEqual([]);
  });
});

describe("patchFor", () => {
  it("maps each status to exactly one column", () => {
    expect(patchFor({ id: "w1", status: "delivered", timestamp: "1700000000" })).toEqual({
      column: "delivered_at",
      patch: { delivered_at: "2023-11-14T22:13:20.000Z" },
    });
    expect(patchFor({ id: "w1", status: "read", timestamp: "1700000000" })?.column).toBe(
      "read_at",
    );
  });

  it("does NOT backfill delivered_at from a read callback", () => {
    // Read implies delivered in reality, but we were never told when. Writing a
    // plausible timestamp we did not receive is the failure mode this project
    // keeps finding — a number that looks right and came from nowhere.
    const r = patchFor({ id: "w1", status: "read", timestamp: "1700000000" });
    expect(r?.patch).not.toHaveProperty("delivered_at");
  });

  it("ignores 'sent', which we stamp ourselves at send time", () => {
    expect(patchFor({ id: "w1", status: "sent", timestamp: "1700000000" })).toBeNull();
  });

  it("carries the failure reason, preferring message over title", () => {
    const r = patchFor({
      id: "w1",
      status: "failed",
      timestamp: "1700000000",
      errors: [{ title: "Generic", message: "Recipient not in allowed list" }],
    });
    expect(r?.column).toBe("failed_at");
    expect(r?.patch.failure_reason).toBe("Recipient not in allowed list");
  });

  it("still records a failure that arrives with no error detail", () => {
    const r = patchFor({ id: "w1", status: "failed", timestamp: "1700000000" });
    expect(r?.patch.failure_reason).toBe("Delivery failed");
  });

  it("ignores a status with no message id to match on", () => {
    expect(patchFor({ status: "read", timestamp: "1700000000" })).toBeNull();
  });

  it("ignores statuses it doesn't record", () => {
    expect(patchFor({ id: "w1", status: "deleted" })).toBeNull();
  });
});

describe("tsToIso", () => {
  it("reads Meta's seconds", () => {
    expect(tsToIso("1700000000")).toBe("2023-11-14T22:13:20.000Z");
  });

  it("falls back to now rather than writing null for junk", () => {
    // A null would render as "never received", which is a stronger claim than
    // "the timestamp was unreadable".
    for (const junk of [undefined, "", "not-a-number", "0", "-5"]) {
      expect(Number.isNaN(Date.parse(tsToIso(junk)))).toBe(false);
    }
  });
});
