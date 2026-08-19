import { describe, expect, it } from "vitest";
import {
  classify,
  collectInbound,
  replyText,
  unknownSenderReply,
} from "@/lib/whatsappInbound";
import type { Reward } from "@/lib/loyalty";
import { whatsAppErrorHelp } from "@/lib/providers";

// Sprint 61. This endpoint is public and its answers go to real phones, so the
// two things worth pinning are: what a customer's text is allowed to MEAN, and
// that a reply never states a number or an offer the shop doesn't have.

const envelope = (messages: unknown[]) => ({
  entry: [{ changes: [{ value: { messages } }] }],
});

const reward = (over: Partial<Reward> = {}): Reward => ({
  id: "r1",
  name: "Free drink",
  description: null,
  points_cost: 50,
  benefit_type: "amount",
  benefit_value: 500,
  active: true,
  ...over,
});

const ctx = {
  shopName: "rice-mice",
  firstName: "Rajesh",
  balance: 0,
  rewards: [] as Reward[],
  signupUrl: "https://rice-mice.vercel.app/s/rice-mice",
};

describe("collectInbound", () => {
  it("reads text, button and list replies alike", () => {
    const got = collectInbound(
      envelope([
        { id: "w1", from: "6581614958", type: "text", text: { body: " balance " } },
        { id: "w2", from: "6581614958", type: "button", button: { text: "STOP" } },
        {
          id: "w3",
          from: "6581614958",
          type: "interactive",
          interactive: { button_reply: { title: "Join" } },
        },
      ]),
    );
    expect(got.map((m) => m.text)).toEqual(["balance", "STOP", "Join"]);
    expect(got.every((m) => m.from === "6581614958")).toBe(true);
  });

  it("skips messages with no text to act on", () => {
    // An image or a sticker must not be answered with a menu it never asked for.
    expect(
      collectInbound(
        envelope([
          { id: "w1", from: "6581614958", type: "image", image: { id: "x" } },
          { id: "w2", from: "6581614958", type: "text", text: { body: "   " } },
          { id: "", from: "6581614958", type: "text", text: { body: "hi" } },
        ]),
      ),
    ).toEqual([]);
  });

  it("survives a delivery-status callback with no messages at all", () => {
    expect(collectInbound({ entry: [{ changes: [{ value: { statuses: [] } }] }] })).toEqual([]);
    expect(collectInbound(null)).toEqual([]);
    expect(collectInbound({})).toEqual([]);
  });

  it("strips formatting from the sender so it matches a stored number", () => {
    const [m] = collectInbound(
      envelope([{ id: "w1", from: "+65 8161 4958", type: "text", text: { body: "hi" } }]),
    );
    expect(m.from).toBe("6581614958");
  });
});

describe("classify", () => {
  it("reads the four keywords, punctuation and case aside", () => {
    expect(classify("STOP.")).toBe("stop");
    expect(classify("  Balance? ")).toBe("balance");
    expect(classify("yes!")).toBe("start");
    expect(classify("what time do you open")).toBe("help");
  });

  it("matches whole words only", () => {
    // "stopping" must not unsubscribe someone, and "appointment" is not an
    // opt-in — a wrong match here silently changes a consent flag.
    expect(classify("no points for stopping by?")).toBe("balance");
    expect(classify("stockist")).toBe("help");
  });

  it("takes consent words ahead of everything else", () => {
    // A message that says both must be read as the opt-out.
    expect(classify("stop sending me points updates")).toBe("stop");
  });

  it("reads two-word phrases", () => {
    expect(classify("please opt out")).toBe("stop");
    expect(classify("opt in please")).toBe("start");
  });
});

describe("replyText", () => {
  it("confirms an opt-out and names the way back", () => {
    const r = replyText("stop", ctx);
    expect(r).toContain("won't send you offers");
    expect(r).toContain("START");
  });

  it("lists only rewards the balance actually covers", () => {
    const r = replyText("balance", {
      ...ctx,
      balance: 60,
      rewards: [reward(), reward({ id: "r2", name: "Free cake", points_cost: 200 })],
    });
    expect(r).toContain("60 points");
    expect(r).toContain("Free drink");
    expect(r).not.toContain("Free cake");
  });

  it("names the gap instead of dangling a reward out of reach", () => {
    const r = replyText("balance", { ...ctx, balance: 20, rewards: [reward()] });
    expect(r).toContain("Another 30");
    expect(r).toContain("Free drink");
  });

  it("never invents a reward when the shop has none", () => {
    const r = replyText("balance", { ...ctx, balance: 40 });
    expect(r).toBe("Hi Rajesh — you have 40 points with rice-mice.");
  });

  it("ignores rewards the shop switched off", () => {
    const r = replyText("balance", {
      ...ctx,
      balance: 400,
      rewards: [reward({ active: false })],
    });
    expect(r).not.toContain("Free drink");
  });

  it("works for a customer whose first name we never captured", () => {
    expect(replyText("balance", { ...ctx, firstName: null, balance: 1 })).toContain(
      "you have 1 point with",
    );
  });

  it("answers anything else with what it can do", () => {
    const r = replyText("help", ctx);
    expect(r).toContain("BALANCE");
    expect(r).toContain("STOP");
  });
});

describe("unknownSenderReply", () => {
  it("sends a stranger to the form rather than guessing them into the database", () => {
    const r = unknownSenderReply("rice-mice", ctx.signupUrl);
    expect(r).toContain(ctx.signupUrl);
    expect(r).toContain("don't have this number");
  });
});

// Sprint 61. "Authentication Error" is what a café owner actually saw on a
// failed send — Meta's own words, and useless. The mapping is the fix.
describe("whatsAppErrorHelp", () => {
  it("turns an expired token into the thing to go and do", () => {
    const help = whatsAppErrorHelp(190, "Authentication Error");
    expect(help).toContain("expired");
    expect(help).toContain("System User token");
    expect(help).not.toBe("Authentication Error");
  });

  it("keeps Meta's own words plus its code when we have nothing better", () => {
    expect(whatsAppErrorHelp(999999, "Something odd")).toBe("Something odd (Meta error 999999)");
  });

  it("passes a codeless error straight through, so email keeps its own wording", () => {
    expect(whatsAppErrorHelp(null, "Invalid `from` field")).toBe("Invalid `from` field");
  });
});
