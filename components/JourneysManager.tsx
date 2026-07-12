"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { buildProfiles, JOURNEY_LABELS, JOURNEY_ORDER, type CustomerRow } from "@/lib/segments";
import {
  entryMatches,
  EMPTY_JOURNEY,
  type Journey,
  type JourneyDefinition,
  type JourneyEntry,
  type JourneyStep,
} from "@/lib/journeys";
import { runJourneyTick } from "@/lib/journeyExecutor";
import { InfoTip } from "@/components/InfoTip";
import type { Order } from "@/lib/orders";

export type RunStub = { id: string; journey_id: string; status: string };

const DURATIONS = [
  { label: "7 days", days: 7 },
  { label: "14 days", days: 14 },
  { label: "30 days", days: 30 },
  { label: "90 days", days: 90 },
  { label: "Evergreen (until stopped)", days: 0 },
];

function statusChip(j: Journey) {
  if (j.status === "running") {
    if (j.run_until && new Date(j.run_until) < new Date())
      return { text: "Window ended", cls: "bg-neutral-100 text-neutral-600" };
    return {
      text: j.run_until
        ? `Running until ${new Date(j.run_until).toLocaleDateString()}`
        : "Running · evergreen",
      cls: "bg-green-100 text-green-700",
    };
  }
  if (j.status === "stopped") return { text: "Stopped", cls: "bg-amber-100 text-amber-700" };
  return { text: "Draft", cls: "bg-neutral-100 text-neutral-600" };
}

export function JourneysManager({
  initialJourneys,
  initialCustomers,
  initialOrders,
  initialRuns,
}: {
  initialJourneys: Journey[];
  initialCustomers: CustomerRow[];
  initialOrders: Order[];
  initialRuns: RunStub[];
}) {
  const [supabase] = useState(() => createClient());
  const [journeys, setJourneys] = useState<Journey[]>(initialJourneys);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [definition, setDefinition] = useState<JourneyDefinition>(structuredClone(EMPTY_JOURNEY));
  const [duration, setDuration] = useState(30);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  // Advance any due runs whenever staff open the designer.
  useEffect(() => {
    runJourneyTick(supabase).catch(() => {});
  }, [supabase]);

  const profiles = useMemo(
    () => buildProfiles(initialCustomers, initialOrders),
    [initialCustomers, initialOrders],
  );
  const matchCount = useMemo(
    () => profiles.filter((p) => entryMatches(definition.entry, p, new Date())).length,
    [definition.entry, profiles],
  );
  const activeRunCount = (id: string) =>
    initialRuns.filter((r) => r.journey_id === id && r.status === "active").length;

  const selected = journeys.find((j) => j.id === selectedId) ?? null;

  function load(j: Journey) {
    setSelectedId(j.id);
    setName(j.name);
    setDefinition(structuredClone(j.definition ?? EMPTY_JOURNEY));
    setNote(null);
  }

  function newJourney() {
    setSelectedId(null);
    setName("");
    setDefinition(structuredClone(EMPTY_JOURNEY));
    setNote(null);
  }

  async function save(): Promise<string | null> {
    setBusy(true);
    setNote(null);
    const cleanName = name.trim() || "Untitled journey";
    if (selectedId) {
      const { error } = await supabase
        .from("journeys")
        .update({ name: cleanName, definition, updated_at: new Date().toISOString() })
        .eq("id", selectedId);
      setBusy(false);
      if (error) {
        setNote("Couldn't save — try again.");
        return null;
      }
      setJourneys((l) => l.map((j) => (j.id === selectedId ? { ...j, name: cleanName, definition } : j)));
      setNote("Saved.");
      return selectedId;
    }
    const id = crypto.randomUUID();
    const { error } = await supabase
      .from("journeys")
      .insert({ id, name: cleanName, definition });
    setBusy(false);
    if (error) {
      setNote("Couldn't save — try again.");
      return null;
    }
    const j: Journey = {
      id,
      name: cleanName,
      definition,
      status: "draft",
      launched_at: null,
      run_until: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      created_by: null,
    };
    setJourneys((l) => [j, ...l]);
    setSelectedId(id);
    setNote("Saved.");
    return id;
  }

  // The human turn of the key: from here the tick may enroll and prepare
  // drafts, for the chosen window or until Stop.
  async function launch() {
    const id = await save();
    if (!id) return;
    setBusy(true);
    const now = new Date();
    const runUntil =
      duration > 0 ? new Date(now.getTime() + duration * 86400000).toISOString() : null;
    const { error } = await supabase
      .from("journeys")
      .update({ status: "running", launched_at: now.toISOString(), run_until: runUntil })
      .eq("id", id);
    if (error) {
      setBusy(false);
      setNote("Couldn't launch — try again.");
      return;
    }
    setJourneys((l) =>
      l.map((j) =>
        j.id === id
          ? { ...j, status: "running", launched_at: now.toISOString(), run_until: runUntil }
          : j,
      ),
    );
    await runJourneyTick(supabase).catch(() => {});
    setBusy(false);
    setNote("Launched — qualifying customers are being enrolled.");
  }

  async function stop() {
    if (!selectedId) return;
    setBusy(true);
    const { error } = await supabase
      .from("journeys")
      .update({ status: "stopped" })
      .eq("id", selectedId);
    setBusy(false);
    if (error) return setNote("Couldn't stop — try again.");
    setJourneys((l) => l.map((j) => (j.id === selectedId ? { ...j, status: "stopped" } : j)));
    setNote("Stopped. In-flight customers are frozen; relaunch to resume.");
  }

  async function remove(j: Journey) {
    if (!window.confirm(`Delete journey “${j.name}” and its history?`)) return;
    const { error } = await supabase.from("journeys").delete().eq("id", j.id);
    if (error) return setNote("Couldn't delete — try again.");
    setJourneys((l) => l.filter((x) => x.id !== j.id));
    if (selectedId === j.id) newJourney();
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          Journeys
          <InfoTip term="journey" align="left" />
        </h1>
        <p className="text-sm text-neutral-500 mt-1">
          Design a flow, launch it for a period (or evergreen), and it prepares
          message drafts into the action inbox — people always press send.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[240px_1fr] gap-6">
        <aside className="space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Your journeys</h2>
            <button onClick={newJourney} className="text-xs text-blue-600 hover:underline">
              + New
            </button>
          </div>
          {journeys.length === 0 && (
            <p className="text-xs text-neutral-400">Nothing yet — design your first flow.</p>
          )}
          {journeys.map((j) => {
            const chip = statusChip(j);
            return (
              <div
                key={j.id}
                onClick={() => load(j)}
                className={`rounded-lg border px-3 py-2 cursor-pointer ${
                  j.id === selectedId ? "border-neutral-900 bg-neutral-50" : "border-neutral-200 bg-white"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm truncate">{j.name}</span>
                  <span className="text-xs text-neutral-500">{activeRunCount(j.id)} in</span>
                </div>
                <div className="flex items-center justify-between mt-1">
                  <span className={`text-[10px] rounded-full px-1.5 py-0.5 ${chip.cls}`}>
                    {chip.text}
                  </span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      remove(j);
                    }}
                    className="text-[11px] text-neutral-400 hover:text-red-600"
                  >
                    delete
                  </button>
                </div>
              </div>
            );
          })}
        </aside>

        <section className="space-y-4">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Journey name (e.g. Win-back journey)"
            className="w-full border border-neutral-300 rounded px-3 py-2 text-lg font-medium"
          />

          <div className="rounded-xl border border-red-200 bg-red-50/50 p-3">
            <div className="text-[10px] tracking-wide text-red-700 mb-1.5">
              WHO ENTERS — evaluated while the journey is running
            </div>
            <EntryEditor
              entry={definition.entry}
              onChange={(entry) => setDefinition((d) => ({ ...d, entry }))}
            />
            <p className="text-xs text-neutral-500 mt-1.5">
              {matchCount} customer{matchCount === 1 ? "" : "s"} would qualify right
              now · each customer enters a journey once
            </p>
          </div>

          <div className="rounded-xl border border-neutral-200 bg-white p-3">
            <div className="text-[10px] tracking-wide text-neutral-400 mb-1.5">THEN</div>
            <StepTreeEditor
              steps={definition.steps}
              onChange={(steps) => setDefinition((d) => ({ ...d, steps }))}
            />
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={definition.exitOnOrder}
              onChange={(e) =>
                setDefinition((d) => ({ ...d, exitOnOrder: e.target.checked }))
              }
            />
            Exit rule: a customer leaves this journey as soon as they place a
            completed order
          </label>

          <div className="rounded-xl border border-neutral-200 bg-white p-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              {selected?.status === "running" ? (
                <>
                  <span className="text-sm text-green-700">
                    {statusChip(selected).text}
                  </span>
                  <button
                    onClick={stop}
                    disabled={busy}
                    className="text-sm border border-neutral-300 rounded px-3 py-1.5 disabled:opacity-50"
                  >
                    Stop journey
                  </button>
                </>
              ) : (
                <>
                  <label className="text-xs text-neutral-500">Run for</label>
                  <select
                    value={duration}
                    onChange={(e) => setDuration(parseInt(e.target.value))}
                    className="border border-neutral-300 rounded px-2 py-1.5 text-sm"
                  >
                    {DURATIONS.map((d) => (
                      <option key={d.label} value={d.days}>
                        {d.label}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={launch}
                    disabled={busy || definition.steps.length === 0}
                    title={
                      definition.steps.length === 0
                        ? "Add at least one step first"
                        : undefined
                    }
                    className="text-sm bg-neutral-900 text-white rounded px-4 py-1.5 disabled:opacity-40"
                  >
                    {busy ? "Working…" : "Launch"}
                  </button>
                </>
              )}
            </div>
            <button
              onClick={save}
              disabled={busy}
              className="text-sm border border-neutral-300 rounded px-3 py-1.5 disabled:opacity-50"
            >
              {selectedId ? "Save changes" : "Save draft"}
            </button>
          </div>
          {note && <p className="text-xs text-neutral-500">{note}</p>}
        </section>
      </div>
    </div>
  );
}

function EntryEditor({
  entry,
  onChange,
}: {
  entry: JourneyEntry;
  onChange: (e: JourneyEntry) => void;
}) {
  function setType(type: string) {
    if (type === "stage") onChange({ type: "stage", stage: "at_risk" });
    else if (type === "no_visit") onChange({ type: "no_visit", days: 30 });
    else if (type === "signed_up") onChange({ type: "signed_up", days: 7 });
    else if (type === "birthday_month") onChange({ type: "birthday_month" });
    else onChange({ type: "tag", tag: "" });
  }
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="text-neutral-500">Customer</span>
      <select
        value={entry.type}
        onChange={(e) => setType(e.target.value)}
        className="border border-neutral-300 rounded px-2 py-1.5 bg-white"
      >
        <option value="stage">is in journey stage</option>
        <option value="no_visit">hasn&apos;t visited in over … days</option>
        <option value="signed_up">signed up in the last … days</option>
        <option value="birthday_month">has a birthday this month</option>
        <option value="tag">has the tag</option>
      </select>
      {entry.type === "stage" && (
        <select
          value={entry.stage}
          onChange={(e) => onChange({ type: "stage", stage: e.target.value as typeof entry.stage })}
          className="border border-neutral-300 rounded px-2 py-1.5 bg-white"
        >
          {JOURNEY_ORDER.map((s) => (
            <option key={s} value={s}>
              {JOURNEY_LABELS[s]}
            </option>
          ))}
        </select>
      )}
      {(entry.type === "no_visit" || entry.type === "signed_up") && (
        <span className="flex items-center gap-1">
          <input
            type="number"
            min={1}
            value={entry.days}
            onChange={(e) =>
              onChange({ ...entry, days: parseInt(e.target.value) || 1 })
            }
            className="w-16 border border-neutral-300 rounded px-2 py-1.5"
          />
          <span className="text-neutral-500">days</span>
        </span>
      )}
      {entry.type === "tag" && (
        <input
          value={entry.tag}
          onChange={(e) => onChange({ type: "tag", tag: e.target.value })}
          placeholder="e.g. Catering"
          className="w-32 border border-neutral-300 rounded px-2 py-1.5"
        />
      )}
    </div>
  );
}

function StepTreeEditor({
  steps,
  onChange,
}: {
  steps: JourneyStep[];
  onChange: (s: JourneyStep[]) => void;
}) {
  const patch = (i: number, step: JourneyStep) =>
    onChange(steps.map((s, j) => (j === i ? step : s)));
  const remove = (i: number) => onChange(steps.filter((_, j) => j !== i));
  const add = (step: JourneyStep) => onChange([...steps, step]);

  return (
    <div className="space-y-2">
      {steps.map((step, i) => (
        <div key={i}>
          {step.type === "wait" && (
            <div className="rounded-lg bg-neutral-50 border border-neutral-200 px-3 py-2 flex items-center gap-2 text-sm">
              <span className="text-neutral-500">Wait</span>
              <input
                type="number"
                min={0}
                value={step.days}
                onChange={(e) =>
                  patch(i, { ...step, days: parseInt(e.target.value) || 0 })
                }
                className="w-16 border border-neutral-300 rounded px-2 py-1"
              />
              <span className="text-neutral-500">days</span>
              <button
                onClick={() => remove(i)}
                className="ml-auto text-neutral-400 hover:text-red-600"
                aria-label="Remove step"
              >
                ×
              </button>
            </div>
          )}
          {step.type === "message" && (
            <div className="rounded-lg bg-violet-50 border border-violet-200 px-3 py-2 text-sm space-y-1.5">
              <div className="flex items-center gap-2">
                <span className="text-violet-700 font-medium text-xs">
                  PREPARE DRAFT → action inbox
                </span>
                <select
                  value={step.channel}
                  onChange={(e) =>
                    patch(i, { ...step, channel: e.target.value as typeof step.channel })
                  }
                  className="border border-neutral-300 rounded px-2 py-1 bg-white text-xs"
                >
                  <option value="whatsapp">WhatsApp</option>
                  <option value="email">Email</option>
                </select>
                <button
                  onClick={() => remove(i)}
                  className="ml-auto text-neutral-400 hover:text-red-600"
                  aria-label="Remove step"
                >
                  ×
                </button>
              </div>
              <textarea
                value={step.body}
                onChange={(e) => patch(i, { ...step, body: e.target.value })}
                rows={2}
                placeholder="Hi {{name}}! …"
                className="w-full border border-neutral-300 rounded px-2 py-1.5 text-sm bg-white"
              />
            </div>
          )}
          {step.type === "branch" && (
            <div className="rounded-lg bg-teal-50 border border-teal-200 px-3 py-2 text-sm space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-teal-700 font-medium text-xs">IF</span>
                <select
                  value={step.condition}
                  onChange={(e) =>
                    patch(i, {
                      ...step,
                      condition: e.target.value as typeof step.condition,
                    })
                  }
                  className="border border-neutral-300 rounded px-2 py-1 bg-white text-xs"
                >
                  <option value="not_visited_since_entry">
                    still hasn&apos;t visited since entering
                  </option>
                  <option value="visited_since_entry">
                    has visited since entering
                  </option>
                </select>
                <button
                  onClick={() => remove(i)}
                  className="ml-auto text-neutral-400 hover:text-red-600"
                  aria-label="Remove branch"
                >
                  ×
                </button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div className="rounded border border-teal-200 bg-white/60 p-2">
                  <div className="text-[10px] text-teal-700 mb-1">YES →</div>
                  <StepTreeEditor
                    steps={step.yes}
                    onChange={(yes) => patch(i, { ...step, yes })}
                  />
                </div>
                <div className="rounded border border-teal-200 bg-white/60 p-2">
                  <div className="text-[10px] text-teal-700 mb-1">NO →</div>
                  <StepTreeEditor
                    steps={step.no}
                    onChange={(no) => patch(i, { ...step, no })}
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      ))}
      <div className="flex gap-2 text-xs">
        <button
          onClick={() => add({ type: "wait", days: 2 })}
          className="border border-neutral-300 rounded px-2 py-1 text-neutral-600 hover:border-neutral-500"
        >
          + Wait
        </button>
        <button
          onClick={() =>
            add({ type: "message", channel: "whatsapp", body: "Hi {{name}}! " })
          }
          className="border border-neutral-300 rounded px-2 py-1 text-neutral-600 hover:border-neutral-500"
        >
          + Message draft
        </button>
        <button
          onClick={() =>
            add({ type: "branch", condition: "not_visited_since_entry", yes: [], no: [] })
          }
          className="border border-neutral-300 rounded px-2 py-1 text-neutral-600 hover:border-neutral-500"
        >
          + Branch
        </button>
      </div>
    </div>
  );
}
