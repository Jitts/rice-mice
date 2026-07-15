"use client";

import { useState } from "react";
import {
  PROVIDERS,
  type ProviderDef,
  type ProviderView,
} from "@/lib/providers";
import { saveProvider, testProvider } from "@/app/actions/providers";

// One card per provider. Secret fields never round-trip: the input starts
// empty with the stored mask as its placeholder, and an empty submit means
// "keep what's saved" (the server does the merge).

function ProviderCard({
  def,
  initial,
}: {
  def: ProviderDef;
  initial: ProviderView;
}) {
  const [view, setView] = useState(initial);
  // Non-secret fields edit their real value; secret fields edit a fresh
  // empty draft ("" = keep stored).
  const [draft, setDraft] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      def.fields.map((f) => [f.key, f.secret ? "" : initial.values[f.key] ?? ""]),
    ),
  );
  const [enabled, setEnabled] = useState(initial.enabled);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [target, setTarget] = useState("");
  const [testState, setTestState] = useState<"idle" | "testing">("idle");
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null);

  async function save() {
    setSaveState("saving");
    setSaveError(null);
    const res = await saveProvider(def.id, draft, enabled);
    if (!res.ok) {
      setSaveState("idle");
      setSaveError(res.error);
      return;
    }
    setView(res.view);
    setEnabled(res.view.enabled);
    // Clear secret drafts so the fresh mask shows as the placeholder again.
    setDraft((d) => {
      const next = { ...d };
      for (const f of def.fields) if (f.secret) next[f.key] = "";
      return next;
    });
    setSaveState("saved");
    setTimeout(() => setSaveState("idle"), 2000);
  }

  async function runTest() {
    setTestState("testing");
    setTestResult(null);
    const res = await testProvider(def.id, target.trim());
    setTestResult(
      res.ok ? { ok: true, text: res.detail } : { ok: false, text: res.error },
    );
    setTestState("idle");
  }

  const status = view.enabled
    ? { text: "Connected", cls: "bg-green-100 dark:bg-green-950/50 text-green-700 dark:text-green-300" }
    : view.configured
      ? { text: "Saved — off", cls: "bg-amber-100 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300" }
      : { text: "Not configured", cls: "bg-muted text-muted-foreground" };

  return (
    <div className="rounded-lg border border-border p-3 space-y-3">
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div>
          <p className="text-sm font-medium">
            {def.label}
            <span className="ml-2 text-xs font-normal text-muted-foreground/70">{def.channel}</span>
          </p>
          <p className="text-xs text-muted-foreground mt-0.5 max-w-md">{def.blurb}</p>
        </div>
        <span className={`text-xs rounded-full px-2 py-0.5 ${status.cls}`}>{status.text}</span>
      </div>

      <div className="flex flex-wrap gap-3">
        {def.fields.map((f) => (
          <label key={f.key} className="block text-sm">
            <span className="block text-xs text-muted-foreground mb-1">
              {f.label}
              {f.optional ? " (optional)" : ""}
            </span>
            <input
              type={f.secret ? "password" : "text"}
              value={draft[f.key] ?? ""}
              onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
              placeholder={
                f.secret && view.values[f.key]
                  ? `${view.values[f.key]} (saved — type to replace)`
                  : f.placeholder
              }
              autoComplete="off"
              className="border border-input rounded px-2 py-1.5 text-sm w-64"
            />
            {f.help && (
              <span className="block text-[11px] text-muted-foreground/70 mt-1 max-w-[16rem]">
                {f.help}
              </span>
            )}
          </label>
        ))}
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
          />
          Enabled
        </label>
        <button
          onClick={save}
          disabled={saveState === "saving"}
          className="text-sm bg-primary text-primary-foreground rounded px-3 py-1.5 disabled:opacity-50"
        >
          {saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved ✓" : "Save"}
        </button>
        {saveError && <p className="text-xs text-destructive">{saveError}</p>}
      </div>

      <div className="border-t border-border/60 pt-2 flex items-center gap-2 flex-wrap">
        {def.test === "send" && (
          <label className="block text-sm">
            <span className="block text-xs text-muted-foreground mb-1">{def.testTargetLabel}</span>
            <input
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              placeholder={def.id === "resend" ? "you@example.com" : "+27821234567"}
              className="border border-input rounded px-2 py-1.5 text-sm w-56"
            />
          </label>
        )}
        <button
          onClick={runTest}
          disabled={testState === "testing" || (def.test === "send" && !target.trim())}
          className="text-sm border border-input rounded px-3 py-1.5 text-muted-foreground hover:border-ring disabled:opacity-50 self-end"
        >
          {testState === "testing"
            ? "Testing…"
            : def.test === "send"
              ? "Send test"
              : "Verify token"}
        </button>
        {testResult && (
          <p className={`text-xs ${testResult.ok ? "text-green-700 dark:text-green-300" : "text-destructive"}`}>
            {testResult.ok ? "✓ " : ""}
            {testResult.text}
          </p>
        )}
      </div>

      {def.note && <p className="text-[11px] text-muted-foreground/70">{def.note}</p>}
      <a
        href={def.docsUrl}
        target="_blank"
        rel="noreferrer"
        className="text-[11px] text-muted-foreground/70 underline hover:text-muted-foreground"
      >
        Where do I get these? →
      </a>
    </div>
  );
}

export function ProvidersManager({ providers }: { providers: ProviderView[] }) {
  const byId = new Map(providers.map((p) => [p.id, p]));
  return (
    <div className="space-y-3">
      {PROVIDERS.map((def) => {
        const view =
          byId.get(def.id) ??
          ({ id: def.id, enabled: false, configured: false, values: {} } as ProviderView);
        return <ProviderCard key={def.id} def={def} initial={view} />;
      })}
      <p className="text-xs text-muted-foreground/70">
        Keys are stored server-side and never sent to the browser — what you see
        above is a masked fingerprint. Tests send a fixed message; save your
        changes first, tests use the saved credentials.
      </p>
    </div>
  );
}
