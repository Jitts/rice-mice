import { describe, it, expect } from "vitest";
import { planMerge, type MergeableCustomer } from "@/lib/customerMerge";

// Sprint 48. The set-based half of a merge — repointing orders, signup events,
// journey runs — lives in migration 0025 and can only be exercised against a
// real database. What is testable here is every rule about which value wins,
// which is deliberately all of them: the SQL applies the fields it is handed
// and decides nothing.

function customer(p: Partial<MergeableCustomer> = {}): MergeableCustomer {
  return {
    id: "a",
    business_id: "shop-1",
    created_at: "2026-03-01T00:00:00.000Z",
    first_name: "Amara",
    last_name: "Okafor",
    phone: null,
    email: null,
    birthday: null,
    notes: null,
    tags: [],
    custom_fields: {},
    whatsapp_opt_in: false,
    email_opt_in: false,
    sms_opt_in: false,
    last_purchase_date: null,
    last_contacted_at: null,
    ...p,
  };
}

function plan(a: Partial<MergeableCustomer>, b: Partial<MergeableCustomer>) {
  const result = planMerge(
    customer({ id: "survivor", ...a }),
    customer({ id: "absorbed", ...b }),
  );
  if (!result.ok) throw new Error(`refused: ${result.reason}`);
  return result.plan;
}

describe("refusals", () => {
  it("refuses to merge a customer into themselves", () => {
    const one = customer({ id: "same" });
    const result = planMerge(one, customer({ id: "same" }));
    expect(result.ok).toBe(false);
  });

  it("refuses two customers from different businesses", () => {
    // The tenant fence, in the layer the confirm screen reads. 0025 checks it
    // again in SQL — this copy is what lets the UI say something useful instead
    // of surfacing a database exception.
    const result = planMerge(
      customer({ id: "a", business_id: "shop-1" }),
      customer({ id: "b", business_id: "shop-2" }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/different businesses/i);
  });
});

describe("contact details", () => {
  it("gives the survivor both handles when each record had one", () => {
    // This is the case the merge tool exists for: an order import refuses a
    // receipt whose email is one record and whose phone is another.
    const fields = plan(
      { email: "amara@example.com", phone: null },
      { email: null, phone: "+6591234567" },
    ).fields;
    expect(fields.email).toBe("amara@example.com");
    expect(fields.phone).toBe("+6591234567");
  });

  it("keeps the survivor's value when both records have one", () => {
    const fields = plan(
      { phone: "+6591111111" },
      { phone: "+6592222222" },
    ).fields;
    expect(fields.phone).toBe("+6591111111");
  });

  it("reports the dropped handle rather than losing it silently", () => {
    const p = plan({ phone: "+6591111111" }, { phone: "+6592222222" });
    expect(p.notes.some((n) => n.includes("+6592222222"))).toBe(true);
  });

  it("takes the absorbed surname when the survivor has none", () => {
    // A one-word name legitimately leaves last_name empty, so "blank" and
    // "absent" have to be the same test here.
    const fields = plan(
      { first_name: "Amara", last_name: "" },
      { first_name: "Amara", last_name: "Okafor" },
    ).fields;
    expect(fields.last_name).toBe("Okafor");
  });
});

describe("dates", () => {
  it("takes the earlier member-since date", () => {
    // They are one person; the older record is when they actually became a
    // customer. Taking the later date would drop them out of past
    // "new customers this month" reports they belonged in.
    const fields = plan(
      { created_at: "2026-06-01T00:00:00.000Z" },
      { created_at: "2025-01-15T00:00:00.000Z" },
    ).fields;
    expect(fields.created_at).toBe("2025-01-15T00:00:00.000Z");
  });

  it("says so when member-since moves", () => {
    const p = plan(
      { created_at: "2026-06-01T00:00:00.000Z" },
      { created_at: "2025-01-15T00:00:00.000Z" },
    );
    expect(p.notes.some((n) => /member-since/i.test(n))).toBe(true);
  });

  it("takes the later last visit and last contact", () => {
    const fields = plan(
      { last_purchase_date: "2026-01-01T00:00:00.000Z", last_contacted_at: null },
      {
        last_purchase_date: "2026-07-30T00:00:00.000Z",
        last_contacted_at: "2026-07-31T00:00:00.000Z",
      },
    ).fields;
    expect(fields.last_purchase_date).toBe("2026-07-30T00:00:00.000Z");
    expect(fields.last_contacted_at).toBe("2026-07-31T00:00:00.000Z");
  });

  it("keeps a last visit the other record doesn't have", () => {
    const fields = plan(
      { last_purchase_date: "2026-01-01T00:00:00.000Z" },
      { last_purchase_date: null },
    ).fields;
    expect(fields.last_purchase_date).toBe("2026-01-01T00:00:00.000Z");
  });
});

describe("tags, notes and custom fields", () => {
  it("unions tags and dedupes them case-insensitively, keeping the first spelling", () => {
    const fields = plan(
      { tags: ["VIP", "regular"] },
      { tags: ["vip", "birthday-club"] },
    ).fields;
    expect(fields.tags).toEqual(["VIP", "regular", "birthday-club"]);
  });

  it("keeps both sets of notes", () => {
    // Staff-written history about a real person. Losing half of it to a
    // housekeeping action is not a trade the user agreed to.
    const fields = plan(
      { notes: "Allergic to peanuts" },
      { notes: "Prefers oat milk" },
    ).fields;
    expect(fields.notes).toContain("Allergic to peanuts");
    expect(fields.notes).toContain("Prefers oat milk");
  });

  it("does not duplicate identical notes", () => {
    const fields = plan({ notes: "Same note" }, { notes: "Same note" }).fields;
    expect(fields.notes).toBe("Same note");
  });

  it("lets the survivor's custom fields win but fills its gaps", () => {
    const fields = plan(
      { custom_fields: { tier: "gold", referrer: "" } },
      { custom_fields: { tier: "silver", referrer: "instagram", size: "L" } },
    ).fields;
    expect(fields.custom_fields).toEqual({
      tier: "gold",
      // An import that wrote "" for a missing column shouldn't beat a real
      // value on the other record.
      referrer: "instagram",
      size: "L",
    });
  });
});

describe("opt-ins take the union", () => {
  it("inherits an opt-in the absorbed record held", () => {
    const p = plan({ email_opt_in: false }, { email_opt_in: true });
    expect(p.fields.email_opt_in).toBe(true);
    expect(p.inheritedOptIns).toEqual(["email_opt_in"]);
  });

  it("keeps the survivor's opt-in when the absorbed record had none", () => {
    const p = plan({ whatsapp_opt_in: true }, { whatsapp_opt_in: false });
    expect(p.fields.whatsapp_opt_in).toBe(true);
    // Not inherited — the survivor already had it, so there is nothing for the
    // confirm screen to warn about.
    expect(p.inheritedOptIns).toEqual([]);
  });

  it("never invents an opt-in neither record held", () => {
    const p = plan({}, {});
    expect(p.fields.whatsapp_opt_in).toBe(false);
    expect(p.fields.email_opt_in).toBe(false);
    expect(p.fields.sms_opt_in).toBe(false);
    expect(p.inheritedOptIns).toEqual([]);
  });

  it("does not let one channel's opt-in imply another's", () => {
    const p = plan({}, { email_opt_in: true });
    expect(p.fields.email_opt_in).toBe(true);
    expect(p.fields.whatsapp_opt_in).toBe(false);
    expect(p.fields.sms_opt_in).toBe(false);
  });
});
