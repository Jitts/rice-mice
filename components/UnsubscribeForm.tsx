"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

type State = "idle" | "loading" | "done" | "notfound" | "error";

export function UnsubscribeForm({ token }: { token: string }) {
  const [state, setState] = useState<State>("idle");

  async function confirm() {
    setState("loading");
    const supabase = createClient();
    const { data, error } = await supabase.rpc("unsubscribe", { p_token: token });
    if (error) return setState("error");
    setState(data ? "done" : "notfound");
  }

  if (state === "done") {
    return (
      <div className="text-center space-y-2">
        <p className="text-2xl font-semibold">You&apos;re unsubscribed.</p>
        <p className="text-muted-foreground text-sm">
          You won&apos;t receive marketing messages from rice-mice. You can opt back in
          any time by signing up again.
        </p>
      </div>
    );
  }

  if (state === "notfound") {
    return (
      <div className="text-center space-y-2">
        <p className="text-xl font-semibold">Link not recognised.</p>
        <p className="text-muted-foreground text-sm">
          This unsubscribe link is invalid or has already been used.
        </p>
      </div>
    );
  }

  return (
    <div className="text-center space-y-4 max-w-sm">
      <p className="text-xl font-semibold">Unsubscribe from rice-mice?</p>
      <p className="text-muted-foreground text-sm">
        You&apos;ll stop receiving WhatsApp and email offers.
      </p>
      {state === "error" && (
        <p className="text-destructive text-sm">Something went wrong — please try again.</p>
      )}
      <button
        onClick={confirm}
        disabled={state === "loading"}
        className="w-full bg-primary text-primary-foreground rounded px-3 py-2 disabled:opacity-50"
      >
        {state === "loading" ? "Unsubscribing…" : "Confirm unsubscribe"}
      </button>
    </div>
  );
}
