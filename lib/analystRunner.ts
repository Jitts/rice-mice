import "server-only";

// The single place that talks to a model provider. The rest of the analyst
// (snapshot builder, system prompt, audit logging) is provider-agnostic; this
// module hides the SDK differences behind one call and one result shape.
//
// server-only keeps both SDKs — and the keys they read from the environment —
// out of any client bundle.

import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import { ANALYST_PROVIDER } from "./analystModel";

export type RunTurn = { role: "user" | "assistant"; content: string };

export type RunResult =
  | { ok: true; text: string; input_tokens?: number; output_tokens?: number }
  | {
      ok: false;
      kind: "auth" | "rate" | "api" | "refusal" | "empty";
      // A short diagnostic (provider error text or finish reason) — logged to
      // audit_log so a failure can be diagnosed without reproducing it.
      message?: string;
    };

export type RunArgs = {
  system: string;
  turns: RunTurn[];
  model: string;
  maxTokens?: number;
};

export async function runAnalyst(args: RunArgs): Promise<RunResult> {
  return ANALYST_PROVIDER === "anthropic"
    ? runAnthropic(args)
    : runGemini(args);
}

// One place to turn a failure into something a shop owner can act on. Was
// copy-pasted into three server actions; the "api" branch in particular said
// only "try again shortly", which hid a revoked key and a retired model id
// behind wording that reads like a transient blip. The provider's own message
// is short, already truncated, and describes the SHOP's configuration — so it
// belongs in front of the person who can fix it.
export function runFailureMessage(
  run: Extract<RunResult, { ok: false }>,
  subject: string,
  keyName: string,
): string {
  switch (run.kind) {
    case "rate":
      return `The ${subject} is busy right now — try again in a minute.`;
    case "auth":
      return `The ${subject}'s API key isn't valid — check ${keyName} in the server environment.`;
    case "refusal":
      return `The ${subject} declined that request — try rephrasing.`;
    case "empty":
      return `The ${subject} returned an empty answer — try rephrasing.`;
    default:
      return run.message
        ? `The ${subject} couldn't reach the AI provider: ${run.message}`
        : `The ${subject} hit an API error — try again shortly.`;
  }
}

// Gemini uses "model" (not "assistant") for its own turns, puts the system
// prompt in config.systemInstruction, and reports safety blocks via
// promptFeedback.blockReason / candidate.finishReason rather than a stop reason.
// Gemini "thinks" by default, and thinking tokens come out of the output
// budget — which silently produced empty answers (finish=MAX_TOKENS, no text).
// The analyst answers over a snapshot that already holds the computed numbers,
// so we want the least thinking the model allows: reliable text, lower cost,
// lower latency.
//
// HOW it's requested changed with Gemini 3. The 2.5 line takes a numeric
// thinkingBudget (0 = off); the 3.x line takes a thinkingLevel enum and
// rejects thinkingBudget with a 400 INVALID_ARGUMENT. That is what broke the
// analyst when the "-latest" aliases rolled onto Gemini 3 — the request shape
// was suddenly wrong, with no change on our side. Branch on the family.
function thinkingConfigFor(model: string) {
  return /^gemini-3/.test(model)
    ? { thinkingLevel: ThinkingLevel.MINIMAL }
    : { thinkingBudget: 0 };
}

async function runGemini({
  system,
  turns,
  model,
  maxTokens = 8000,
}: RunArgs): Promise<RunResult> {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  try {
    const res = await ai.models.generateContent({
      model,
      contents: turns.map((t) => ({
        role: t.role === "assistant" ? "model" : "user",
        parts: [{ text: t.content }],
      })),
      config: {
        systemInstruction: system,
        temperature: 0.3,
        maxOutputTokens: maxTokens,
        thinkingConfig: thinkingConfigFor(model),
      },
    });

    if (res.promptFeedback?.blockReason)
      return { ok: false, kind: "refusal", message: `blocked:${res.promptFeedback.blockReason}` };

    const candidate = res.candidates?.[0];
    const finish = candidate?.finishReason;
    if (
      finish &&
      ["SAFETY", "PROHIBITED_CONTENT", "RECITATION", "BLOCKLIST", "SPII"].includes(
        finish,
      )
    )
      return { ok: false, kind: "refusal", message: `finish:${finish}` };

    // Read parts directly rather than the .text getter, which warns/throws when
    // a candidate has no textual content.
    const text = (candidate?.content?.parts ?? [])
      .map((p) => (typeof p.text === "string" ? p.text : ""))
      .join("")
      .trim();
    if (!text) return { ok: false, kind: "empty", message: `finish:${finish ?? "none"}` };

    return {
      ok: true,
      text,
      input_tokens: res.usageMetadata?.promptTokenCount,
      output_tokens: res.usageMetadata?.candidatesTokenCount,
    };
  } catch (err) {
    const e = err as { status?: number; message?: string };
    const message = (e?.message || String(err)).slice(0, 300);
    if (e?.status === 429) return { ok: false, kind: "rate", message };
    if (e?.status === 401 || e?.status === 403) return { ok: false, kind: "auth", message };
    // Google returns 400 INVALID_ARGUMENT (not 401) for a revoked or malformed
    // key, so key problems would otherwise be reported as a transient API blip.
    if (/api[\s_-]?key/i.test(message)) return { ok: false, kind: "auth", message };
    return { ok: false, kind: "api", message };
  }
}

async function runAnthropic({
  system,
  turns,
  model,
  maxTokens = 8000,
}: RunArgs): Promise<RunResult> {
  const client = new Anthropic();
  try {
    const response = await client.messages.create({
      model,
      max_tokens: maxTokens,
      thinking: { type: "adaptive" },
      output_config: { effort: "medium" },
      system,
      messages: turns.map((t) => ({ role: t.role, content: t.content })),
    });
    if (response.stop_reason === "refusal")
      return { ok: false, kind: "refusal", message: "stop_reason:refusal" };
    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
    if (!text) return { ok: false, kind: "empty", message: `stop_reason:${response.stop_reason}` };
    return {
      ok: true,
      text,
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
    };
  } catch (err) {
    const message = ((err as { message?: string })?.message || String(err)).slice(0, 300);
    if (err instanceof Anthropic.RateLimitError) return { ok: false, kind: "rate", message };
    if (err instanceof Anthropic.AuthenticationError)
      return { ok: false, kind: "auth", message };
    return { ok: false, kind: "api", message };
  }
}
