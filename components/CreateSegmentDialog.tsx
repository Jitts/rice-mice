"use client";

// Sprint 52. One dialog, two entry points: a Reports finding's campaign button
// (where the criteria arrive pre-filled from lib/suggestions.ts) and the
// composer's "＋ Create new…" audience option (where they start empty).
//
// It exists because the alternative was creating a segment silently. The
// dashboard's Suggested Actions still does that, and it is exactly how the
// overwrite below went unnoticed: a shop that had named a segment "At risk —
// win-back (auto)" had its definition replaced by a button that never mentioned
// the segment at all.

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { SegmentBuilder } from "@/components/SegmentBuilder";
import {
  buildFieldRegistry,
  collectOptions,
  filterProfiles,
  isReachable,
  suggestSegmentName,
  type CustomerProfile,
  type CustomFieldRow,
  type SegmentDefinition,
} from "@/lib/segments";

export type DialogSegment = { id: string; name: string; definition: SegmentDefinition };

const EMPTY_DEFINITION: SegmentDefinition = {
  type: "group",
  combinator: "all",
  children: [],
};

export function CreateSegmentDialog({
  open,
  onClose,
  onSaved,
  profiles,
  customFields,
  segments,
  initialName,
  initialDefinition,
  saving: savingLabel = "Save audience",
}: {
  open: boolean;
  onClose: () => void;
  onSaved: (segment: DialogSegment) => void;
  profiles: CustomerProfile[];
  customFields: CustomFieldRow[];
  segments: { id: string; name: string; definition: SegmentDefinition | null }[];
  initialName: string;
  initialDefinition: SegmentDefinition;
  saving?: string;
}) {
  const [name, setName] = useState(initialName);
  const [definition, setDefinition] = useState<SegmentDefinition>(initialDefinition);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Whether the name we opened with was already taken. Kept separate from the
  // name itself so the notice stays on screen after the proposal is applied —
  // "we changed this for you" is the part worth seeing.
  const [renamedFrom, setRenamedFrom] = useState<string | null>(null);

  const taken = useMemo(() => segments.map((s) => s.name), [segments]);

  // Re-seed each time it opens. Without this, opening the dialog for a second
  // finding would show the first one's criteria.
  useEffect(() => {
    if (!open) return;
    const free = suggestSegmentName(initialName, taken);
    setName(free);
    setRenamedFrom(free === initialName.trim() ? null : initialName.trim());
    setDefinition(initialDefinition);
    setError(null);
  }, [open, initialName, initialDefinition, taken]);

  const fieldRegistry = useMemo(() => buildFieldRegistry(customFields), [customFields]);
  const options = useMemo(() => collectOptions(profiles, []), [profiles]);
  const segmentsById = useMemo(
    () => Object.fromEntries(segments.map((s) => [s.id, s.definition ?? EMPTY_DEFINITION])),
    [segments],
  );
  const segmentOptions = useMemo(
    () => segments.map((s) => ({ id: s.id, name: s.name })),
    [segments],
  );

  const matched = useMemo(
    () => filterProfiles(definition, profiles, fieldRegistry.byId, segmentsById),
    [definition, profiles, fieldRegistry, segmentsById],
  );
  const reachable = useMemo(() => matched.filter(isReachable).length, [matched]);

  // Live, because the count is the thing being agreed to. A name typed over an
  // existing one has to be caught here too, not only on open.
  const clash = useMemo(
    () => taken.some((t) => t.trim().toLowerCase() === name.trim().toLowerCase()),
    [taken, name],
  );

  if (!open) return null;

  async function save() {
    const trimmed = name.trim();
    if (!trimmed || clash) return;
    setBusy(true);
    setError(null);
    const id = crypto.randomUUID();
    const { error: insertError } = await createClient()
      .from("segments")
      .insert({ id, name: trimmed, definition });
    setBusy(false);
    if (insertError) {
      setError("Couldn't save this audience — try again.");
      return;
    }
    onSaved({ id, name: trimmed, definition });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-8"
      role="dialog"
      aria-modal="true"
      aria-label="Create an audience"
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <div className="w-full max-w-2xl rounded-xl border border-border bg-card p-5 space-y-4 shadow-lg">
        <div>
          <h2 className="font-heading text-lg font-bold tracking-tight">Create this audience</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Saved as a segment you can reuse. Nothing is sent — the next screen is the
            composer, where you review and approve.
          </p>
        </div>

        {error && (
          <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}

        <div>
          <label
            htmlFor="segment-name"
            className="block text-xs uppercase tracking-wide text-muted-foreground/70 mb-1"
          >
            Name
          </label>
          <input
            id="segment-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
          />
          {renamedFrom && !clash && (
            <p className="text-xs text-muted-foreground mt-1">
              You already have an audience called “{renamedFrom}”, so this one was named
              differently. Your existing audience is untouched.
            </p>
          )}
          {clash && (
            <p className="text-xs text-destructive mt-1">
              That name is taken. Pick another so the two don’t look identical in the list.
            </p>
          )}
        </div>

        <div>
          <p className="block text-xs uppercase tracking-wide text-muted-foreground/70 mb-1">
            Who this includes
          </p>
          <SegmentBuilder
            definition={definition}
            onChange={setDefinition}
            options={options}
            fields={fieldRegistry.list}
            fieldsById={fieldRegistry.byId}
            segmentOptions={segmentOptions}
          />
        </div>

        <div className="rounded-lg border border-border bg-muted px-3 py-2 text-sm">
          <span className="font-semibold">{matched.length}</span> match this ·{" "}
          <span className="font-semibold">{reachable}</span> can be messaged
          {matched.length > 0 && reachable === 0 && (
            <span className="text-muted-foreground">
              {" "}
              — nobody here has opted in, so a campaign would reach no one
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-3 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="text-sm text-muted-foreground hover:text-foreground underline"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy || !name.trim() || clash}
            onClick={() => void save()}
            className="text-sm bg-primary text-primary-foreground rounded-lg px-4 py-2 hover:bg-primary/90 disabled:opacity-50"
          >
            {busy ? "Saving…" : savingLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
