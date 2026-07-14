"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { askAnalyst, type AnalystTurn } from "@/app/actions/analyst";

// The analyst Q&A panel on Reports. The model only ever sees the read-only
// snapshot the server action builds — this component just carries the
// conversation. "Ask why" on a finding prefills the input; the user still
// presses Send, so every model call is human-initiated.

export function AnalystChat({
  ready,
  prefill,
}: {
  ready: boolean;
  prefill: { text: string; n: number } | null;
}) {
  const [messages, setMessages] = useState<AnalystTurn[]>([]);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (prefill && prefill.n > 0) {
      setInput(prefill.text);
      inputRef.current?.focus();
    }
  }, [prefill]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [messages, busy]);

  function send() {
    const question = input.trim();
    if (!question || busy) return;
    const history = messages;
    setMessages((m) => [...m, { role: "user", content: question }]);
    setInput("");
    setError(null);
    startTransition(async () => {
      const result = await askAnalyst(question, history);
      if (result.ok) {
        setMessages((m) => [...m, { role: "assistant", content: result.answer }]);
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <section id="analyst" className="rounded-xl border border-neutral-200 bg-white">
      <div className="px-4 pt-4 pb-2 flex items-baseline justify-between flex-wrap gap-1">
        <h2 className="text-sm font-semibold">Ask the analyst</h2>
        <p className="text-xs text-neutral-400">
          Answers come only from your dashboard numbers — it can&apos;t change
          anything.
        </p>
      </div>

      {!ready ? (
        <p className="px-4 pb-4 text-sm text-neutral-500">
          Not connected yet. Add <code className="text-xs bg-neutral-100 rounded px-1">ANTHROPIC_API_KEY</code>{" "}
          to the server environment (Vercel → Settings → Environment Variables)
          and redeploy to switch the analyst on. Findings above work without it.
        </p>
      ) : (
        <>
          {(messages.length > 0 || busy) && (
            <div
              ref={logRef}
              className="max-h-80 overflow-y-auto px-4 pb-2 space-y-3"
            >
              {messages.map((m, i) =>
                m.role === "user" ? (
                  <p
                    key={i}
                    className="text-sm bg-neutral-900 text-white rounded-xl rounded-br-sm px-3 py-2 ml-10 w-fit max-w-full whitespace-pre-wrap"
                  >
                    {m.content}
                  </p>
                ) : (
                  <p
                    key={i}
                    className="text-sm bg-neutral-100 rounded-xl rounded-bl-sm px-3 py-2 mr-10 w-fit max-w-full whitespace-pre-wrap"
                  >
                    {m.content}
                  </p>
                ),
              )}
              {busy && (
                <p className="text-sm text-neutral-400 animate-pulse">
                  Reading your numbers…
                </p>
              )}
            </div>
          )}
          {error && <p className="px-4 pb-2 text-sm text-red-600">{error}</p>}
          <div className="border-t border-neutral-100 p-3 flex gap-2 items-end">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              rows={2}
              maxLength={600}
              placeholder='Try "Which campaign earned the most?" or "Who are my top customers this month?"'
              className="flex-1 resize-none text-sm border border-neutral-300 rounded-lg px-3 py-2 focus:outline-none focus:border-neutral-500"
            />
            <button
              onClick={send}
              disabled={busy || !input.trim()}
              className="text-sm bg-neutral-900 text-white rounded-lg px-4 py-2 disabled:opacity-40"
            >
              {busy ? "…" : "Send"}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
