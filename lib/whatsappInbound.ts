// Sprint 61 — the pure half of inbound WhatsApp. The webhook route does the
// database work; everything here is a function of its arguments so the routing
// and the wording can be tested without a network or a shop.
//
// Why inbound matters commercially, in one line: a message the CUSTOMER starts
// can be answered in free text for 24 hours, with no Meta-approved template and
// no per-wording approval queue. Everything the business starts needs a
// template. So the cheap, unlimited half of WhatsApp is the half that begins
// with them texting us — which is what this file answers.

import { canAfford, rewardBenefitLabel, type Reward } from "@/lib/loyalty";

export type InboundMessage = { id: string; from: string; text: string };

type Envelope = {
  entry?: {
    changes?: {
      value?: {
        messages?: {
          id?: string;
          from?: string;
          type?: string;
          text?: { body?: string };
          button?: { text?: string };
          interactive?: {
            button_reply?: { title?: string };
            list_reply?: { title?: string };
          };
        }[];
      };
    }[];
  }[];
};

// Text, quick-reply buttons and list picks all collapse to "what they said".
// Anything else (image, sticker, location, audio) is skipped rather than
// answered with a menu it didn't ask for.
export function collectInbound(payload: unknown): InboundMessage[] {
  const out: InboundMessage[] = [];
  for (const e of (payload as Envelope)?.entry ?? [])
    for (const c of e.changes ?? [])
      for (const m of c.value?.messages ?? []) {
        const text =
          m.text?.body ??
          m.button?.text ??
          m.interactive?.button_reply?.title ??
          m.interactive?.list_reply?.title ??
          "";
        const from = (m.from ?? "").replace(/\D/g, "");
        if (!m.id || !from || !text.trim()) continue;
        out.push({ id: m.id, from, text: text.trim() });
      }
  return out;
}

export type Intent = "balance" | "stop" | "start" | "help";

// Deliberately a keyword match, not a model call. Four intents, answered in
// milliseconds, with no per-message cost and no way for a customer's text to
// become an instruction — this endpoint is public and its replies go to real
// phones, which is the last place an injectable prompt belongs.
//
// ponytail: keyword matching, English only. Swap in the analyst runner when
// customers start asking things these four words don't cover — the shape here
// (classify, then answer from stored facts) already fits a model behind it.
const RULES: { intent: Intent; words: string[] }[] = [
  { intent: "stop", words: ["stop", "unsubscribe", "opt out", "optout"] },
  { intent: "start", words: ["start", "yes", "join", "subscribe", "opt in", "optin"] },
  { intent: "balance", words: ["balance", "points", "point", "reward", "rewards"] },
];

export function classify(text: string): Intent {
  // Punctuation-insensitive so "STOP." and "stop!" land the same way, and
  // whole-word so "no points for stopping" can't read as an opt-out.
  const words = new Set(text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean));
  const normalised = ` ${[...words].join(" ")} `;
  for (const rule of RULES)
    if (rule.words.some((w) => (w.includes(" ") ? normalised.includes(` ${w} `) : words.has(w))))
      return rule.intent;
  return "help";
}

export type ReplyContext = {
  shopName: string;
  firstName: string | null;
  balance: number;
  rewards: Reward[];
  signupUrl: string;
};

// What a reward costs, phrased for someone standing at a counter.
function rewardLine(r: Reward): string {
  return `${r.name} (${rewardBenefitLabel(r)}) — ${r.points_cost} points`;
}

function balanceReply(ctx: ReplyContext): string {
  const hi = ctx.firstName ? `Hi ${ctx.firstName}` : "Hi";
  const active = ctx.rewards.filter((r) => r.active).sort((a, b) => a.points_cost - b.points_cost);
  const points = `${ctx.balance} point${ctx.balance === 1 ? "" : "s"}`;
  if (active.length === 0) return `${hi} — you have ${points} with ${ctx.shopName}.`;

  const affordable = active.filter((r) => canAfford(ctx.balance, r));
  if (affordable.length > 0)
    return `${hi} — you have ${points}. You can redeem: ${affordable
      .map(rewardLine)
      .join("; ")}. Just show this at the counter.`;

  // Nothing affordable yet: name the gap to the nearest reward rather than
  // listing everything they can't have.
  const next = active[0];
  const short = next.points_cost - ctx.balance;
  return `${hi} — you have ${points}. Another ${short} and you can redeem ${rewardLine(next)}.`;
}

export function replyText(intent: Intent, ctx: ReplyContext): string {
  if (intent === "stop")
    return `Done — ${ctx.shopName} won't send you offers on WhatsApp any more. Text START if you change your mind.`;
  if (intent === "start")
    return `You're in — ${ctx.shopName} will send offers to this number. Text STOP any time to turn them off.`;
  if (intent === "balance") return balanceReply(ctx);
  return `Hi! Text BALANCE for your points and rewards, START to get offers from ${ctx.shopName}, or STOP to turn them off.`;
}

// Someone messaging from a number we've never seen. We can't tell them a
// balance and we can't opt them in — texting a shop is contact, not consent to
// be marketed at, and we don't have their name either. So the only honest
// answer is the sign-up form.
//
// ponytail: no name capture over chat. Add a two-turn "what's your name?"
// exchange when the sign-up link's completion rate says the extra hop is
// costing more than the conversation would.
export function unknownSenderReply(shopName: string, signupUrl: string): string {
  return `Hi! We don't have this number saved at ${shopName} yet. Join here and you'll start earning points: ${signupUrl}`;
}
