import "server-only";

// The single place that talks to a model provider. The rest of the analyst
// (snapshot builder, system prompt, audit logging) is provider-agnostic; this
// module hides the SDK differences behind one call and one result shape.
//
// server-only keeps both SDKs — and the keys they read from the environment —
// out of any client bundle.

import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenAI } from "@google/genai";
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

// Gemini uses "model" (not "assistant") for its own turns, puts the system
// prompt in config.systemInstruction, and reports safety blocks via
// promptFeedback.blockReason / candidate.finishReason rather than a stop reason.
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
