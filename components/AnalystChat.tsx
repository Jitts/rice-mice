"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { askAnalyst, type AnalystTurn } from "@/app/actions/analyst";

// The analyst Q&A panel on Reports. The model only ever sees the read-only
// snapshot the server action builds — this component just carries the
// conversation. "Ask why" on a finding prefills the input; the user still
// presses Send, so every model call is human-initiated.

export function AnalystChat({
  ready,
  keyName,
  prefill,
  embedded = false,
}: {
  ready: boolean;
  keyName: string;
  prefill: { text: string; n: number } | null;
  // In the right rail the panel supplies the card and the heading, and the
  // conversation should grow to fill the available height instead of capping
  // at a fixed max — so the chrome comes off and the log flexes.
  embedded?: boolean;
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
    <section
      id="analyst"
      className={
        embedded
          ? "flex flex-col flex-1 min-h-0"
          : "rounded-xl border border-border bg-card"
      }
    >
      <div
        className={`flex items-baseline justify-between flex-wrap gap-1 ${
          embedded ? "px-3 pt-3 pb-2" : "px-4 pt-4 pb-2"
        }`}
      >
        {!embedded && <h2 className="text-sm font-semibold">Ask the analyst</h2>}
        <p className="text-xs text-muted-foreground/70">
          Answers come only from your dashboard numbers — it can&apos;t change
          anything.
        </p>
      </div>

      {!ready ? (
        <p className={`text-sm text-muted-foreground ${embedded ? "px-3 pb-3" : "px-4 pb-4"}`}>
          Not connected yet. Add <code className="text-xs bg-muted rounded px-1">{keyName}</code>{" "}
          to the server environment (Vercel → Settings → Environment Variables)
          and redeploy to switch the analyst on. Findings above work without it.
        </p>
      ) : (
        <>
          {(messages.length > 0 || busy) && (
            <div
              ref={logRef}
              className={`overflow-y-auto space-y-3 ${
                embedded ? "flex-1 min-h-0 px-3 pb-2" : "max-h-80 px-4 pb-2"
              }`}
            >
              {messages.map((m, i) =>
                m.role === "user" ? (
                  <p
                    key={i}
                    className="text-sm bg-primary text-primary-foreground rounded-xl rounded-br-sm px-3 py-2 ml-10 w-fit max-w-full whitespace-pre-wrap"
                  >
                    {m.content}
                  </p>
                ) : (
                  <p
                    key={i}
                    className="text-sm bg-muted rounded-xl rounded-bl-sm px-3 py-2 mr-10 w-fit max-w-full whitespace-pre-wrap"
                  >
                    {m.content}
                  </p>
                ),
              )}
              {busy && (
                <p className="text-sm text-muted-foreground/70 animate-pulse">
                  Reading your numbers…
                </p>
              )}
            </div>
          )}
          {error && (
            <p className={`pb-2 text-sm text-destructive ${embedded ? "px-3" : "px-4"}`}>
              {error}
            </p>
          )}
          {/* mt-auto pins the composer to the bottom when the log is short. */}
          <div
            className={`border-t border-border/60 p-3 flex gap-2 items-end ${
              embedded ? "mt-auto" : ""
            }`}
          >
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
              placeholder={
                embedded
                  ? 'Try "Which campaign earned the most?"'
                  : 'Try "Which campaign earned the most?" or "Who are my top customers this month?"'
              }
              className="flex-1 resize-none text-sm border border-input rounded-lg px-3 py-2 focus:outline-none focus:border-ring"
            />
            <button
              onClick={send}
              disabled={busy || !input.trim()}
              className="text-sm bg-primary text-primary-foreground rounded-lg px-4 py-2 disabled:opacity-40"
            >
              {busy ? "…" : "Send"}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
