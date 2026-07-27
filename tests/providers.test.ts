import { describe, it, expect } from "vitest";
import { buildWhatsAppTemplatePayload } from "@/lib/providers";

// Sprint 40 — the WhatsApp template payload builder gained a bodyParams arg
// so a real campaign template's {{1}}, {{2}}… slots can be filled. The
// existing zero-arg call (used by the Settings "Test" button, hello_world)
// must keep producing a components-free payload — Meta rejects a components
// array on templates that declare no variables.

describe("buildWhatsAppTemplatePayload", () => {
  it("omits components when no params are given (hello_world test send)", () => {
    const payload = buildWhatsAppTemplatePayload("+6591234567");
    if ("error" in payload) throw new Error("expected a payload");
    expect(payload.template?.components).toBeUndefined();
    expect(payload.template?.name).toBe("hello_world");
  });

  it("fills body components in order when params are given", () => {
    const payload = buildWhatsAppTemplatePayload(
      "+6591234567",
      "order_promo",
      "en_US",
      ["Sarah", "SAVE20"],
    );
    if ("error" in payload) throw new Error("expected a payload");
    expect(payload.template?.components).toEqual([
      {
        type: "body",
        parameters: [
          { type: "text", text: "Sarah" },
          { type: "text", text: "SAVE20" },
        ],
      },
    ]);
  });

  it("rejects an invalid recipient number", () => {
    const payload = buildWhatsAppTemplatePayload("not-a-number");
    expect(payload).toEqual({ error: "Recipient phone number looks invalid" });
  });
});
