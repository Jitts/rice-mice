"use client";

// Past imports, with an undo per run. Undo is scoped to a batch — not a
// filename and not a time window — so the same file imported twice appears
// twice and each is reversed independently.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { undoImport } from "@/app/actions/importUndo";

export type ImportBatchRow = {
  id: string;
  filename: string;
  created_at: string;
  created_count: number;
  updated_count: number;
  /** How many of this batch's customers are still present. */
  present: number;
};

export function ImportHistory({ batches }: { batches: ImportBatchRow[] }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Undoing the only batch empties this list, and router.refresh() would then
  // unmount the panel — taking the "removed N customers" confirmation with it,
  // so a destructive action would appear to do nothing. Keep the panel alive
  // while there is a result to report.
  if (batches.length === 0 && !note && !error) return null;

  async function run(id: string) {
    setBusy(id);
    setError(null);
    setNote(null);
    const res = await undoImport(id);
    setBusy(null);
    setConfirming(null);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setNote(
      res.kept > 0
        ? `Removed ${res.deleted} customers. ${res.kept} were kept because ${res.keptReason}.`
        : `Removed ${res.deleted} customers.`,
    );
    router.refresh();
  }

  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="px-5 py-3 border-b border-border">
        <h2 className="font-semibold text-sm">Past imports</h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          Undo removes the customers an import added. It never deletes anyone who has
          ordered or been messaged since, and it can&apos;t revert rows an import updated.
        </p>
      </div>

      {error && (
        <p className="mx-5 mt-3 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}
      {note && (
        <p className="mx-5 my-3 rounded-lg border border-border bg-muted px-3 py-2 text-sm">
          {note}
        </p>
      )}

      <ul className={batches.length === 0 ? "hidden" : "divide-y divide-border/60"}>
        {batches.map((b) => {
          const emptied = b.present === 0;
          return (
            <li key={b.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
              <div className="min-w-0">
                <p className="text-sm font-medium truncate" title={b.filename}>
                  {b.filename}
                </p>
                <p className="text-xs text-muted-foreground">
                  {new Date(b.created_at).toLocaleString()} · added {b.created_count}
                  {b.updated_count > 0 && ` · updated ${b.updated_count}`}
                  {!emptied && b.present !== b.created_count && ` · ${b.present} still present`}
                </p>
                {b.updated_count > 0 && (
                  <p className="text-xs text-muted-foreground/80 mt-0.5">
                    The {b.updated_count} updated{" "}
                    {b.updated_count === 1 ? "customer keeps its" : "customers keep their"} imported
                    values — undo can&apos;t restore what they held before.
                  </p>
                )}
              </div>

              {emptied ? (
                <span className="text-xs text-muted-foreground whitespace-nowrap">Undone</span>
              ) : confirming === b.id ? (
                <span className="flex items-center gap-2 whitespace-nowrap">
                  <span className="text-sm">Remove {b.present}?</span>
                  <button
                    type="button"
                    disabled={busy === b.id}
                    onClick={() => void run(b.id)}
                    className="text-sm rounded-lg bg-destructive px-3 py-1.5 text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50"
                  >
                    {busy === b.id ? "Removing…" : "Yes, remove"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirming(null)}
                    className="text-sm text-muted-foreground hover:text-foreground"
                  >
                    Cancel
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setConfirming(b.id);
                    setNote(null);
                    setError(null);
                  }}
                  className="text-sm text-muted-foreground hover:text-destructive underline whitespace-nowrap"
                >
                  Undo this import
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
