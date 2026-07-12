"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { buildProfiles, JOURNEY_LABELS, JOURNEY_ORDER, type CustomerRow } from "@/lib/segments";
import {
  entryMatches,
  getEntry,
  validateGraph,
  EMPTY_JOURNEY,
  type BranchCondition,
  type Journey,
  type JourneyDefinition,
  type JourneyEntry,
} from "@/lib/journeys";
import { runJourneyTick } from "@/lib/journeyExecutor";
import { JourneyCanvas } from "@/components/JourneyCanvas";
import { InfoTip } from "@/components/InfoTip";
import type { CampaignChannel } from "@/lib/campaigns";
import type { Order } from "@/lib/orders";

export type RunStub = { id: string; journey_id: string; status: string };
export type OfferCampaign = { id: string; name: string; offer_code: string };

const DURATIONS = [
  { label: "7 days", days: 7 },
  { label: "14 days", days: 14 },
  { label: "30 days", days: 30 },
  { label: "90 days", days: 90 },
  { label: "Evergreen (until stopped)", days: 0 },
];

const VARIABLES = ["{{name}}", "{{full_name}}", "{{days_away}}", "{{code}}"];

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

function isGraph(def: unknown): def is JourneyDefinition {
  return !!def && typeof def === "object" && Array.isArray((def as JourneyDefinition).nodes);
}

export function JourneysManager({
  initialJourneys,
  initialCustomers,
  initialOrders,
  initialRuns,
  offerCampaigns,
}: {
  initialJourneys: Journey[];
  initialCustomers: CustomerRow[];
  initialOrders: Order[];
  initialRuns: RunStub[];
  offerCampaigns: OfferCampaign[];
}) {
  const [supabase] = useState(() => createClient());
  const [journeys, setJourneys] = useState<Journey[]>(initialJourneys);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [definition, setDefinition] = useState<JourneyDefinition>(
    structuredClone(EMPTY_JOURNEY),
  );
  const [selectedNode, setSelectedNode] = useState<string | null>("trigger");
  const [duration, setDuration] = useState(30);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    runJourneyTick(supabase).catch(() => {});
  }, [supabase]);

  const profiles = useMemo(
    () => buildProfiles(initialCustomers, initialOrders),
    [initialCustomers, initialOrders],
  );
  const entry = getEntry(definition);
  const matchCount = useMemo(
    () =>
      entry ? profiles.filter((p) => entryMatches(entry, p, new Date())).length : 0,
    [entry, profiles],
  );
  const problems = useMemo(() => validateGraph(definition), [definition]);
  const activeRunCount = (id: string) =>
    initialRuns.filter((r) => r.journey_id === id && r.status === "active").length;

  const selected = journeys.find((j) => j.id === selectedId) ?? null;
  const node = definition.nodes.find((n) => n.id === selectedNode) ?? null;

  function load(j: Journey) {
    setSelectedId(j.id);
    setName(j.name);
    setDefinition(
      isGraph(j.definition) ? structuredClone(j.definition) : structuredClone(EMPTY_JOURNEY),
    );
    setSelectedNode("trigger");
    setNote(null);
  }

  function newJourney() {
    setSelectedId(null);
    setName("");
    setDefinition(structuredClone(EMPTY_JOURNEY));
    setSelectedNode("trigger");
    setNote(null);
  }

  function patchNode(id: string, data: Partial<JourneyDefinition["nodes"][number]["data"]>) {
    setDefinition((d) => ({
      ...d,
      nodes: d.nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...data } } : n)),
    }));
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
      setJourneys((l) =>
        l.map((j) => (j.id === selectedId ? { ...j, name: cleanName, definition } : j)),
      );
      setNote("Saved.");
      return selectedId;
    }
    const id = crypto.randomUUID();
    const { error } = await supabase.from("journeys").insert({ id, name: cleanName, definition });
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

  async function launch() {
    if (problems.length > 0) return;
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
          Draw a flow on the canvas, launch it for a period (or evergreen), and
          it prepares message drafts into the action inbox — people always press
          send.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[220px_minmax(0,1fr)] gap-6">
        <aside className="space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Your journeys</h2>
            <button onClick={newJourney} className="text-xs text-blue-600 hover:underline">
              + New
            </button>
          </div>
          {journeys.length === 0 && (
            <p className="text-xs text-neutral-400">Nothing yet — draw your first flow.</p>
          )}
          {journeys.map((j) => {
            const chip = statusChip(j);
            return (
              <div
                key={j.id}
                onClick={() => load(j)}
                className={`rounded-lg border px-3 py-2 cursor-pointer ${
                  j.id === selectedId
                    ? "border-neutral-900 bg-neutral-50"
                    : "border-neutral-200 bg-white"
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

        <section className="space-y-3">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Journey name (e.g. Win-back journey)"
            className="w-full border border-neutral-300 rounded px-3 py-2 text-lg font-medium"
          />

          <JourneyCanvas
            definition={definition}
            onChange={setDefinition}
            onSelect={setSelectedNode}
          />

          <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_240px] gap-3 items-start">
            <div className="rounded-xl border border-neutral-200 bg-white p-3 min-h-[92px]">
              {!node && (
                <p className="text-xs text-neutral-400">
                  Select a node on the canvas to edit it.
                </p>
              )}
              {node?.type === "trigger" && (
                <>
                  <div className="text-[10px] tracking-wide text-neutral-400 mb-1.5">
                    TRIGGER — WHO ENTERS WHILE RUNNING
                  </div>
                  <EntryEditor
                    entry={node.data.entry ?? { type: "stage", stage: "at_risk" }}
                    onChange={(entry) => patchNode(node.id, { entry })}
                  />
                  <p className="text-xs text-neutral-500 mt-1.5">
                    {matchCount} customer{matchCount === 1 ? "" : "s"} would qualify right
                    now · each customer enters once
                  </p>
                </>
              )}
              {node?.type === "wait" && (
                <>
                  <div className="text-[10px] tracking-wide text-neutral-400 mb-1.5">WAIT</div>
                  <div className="flex items-center gap-2 text-sm">
                    <input
                      type="number"
                      min={0}
                      value={node.data.days ?? 0}
                      onChange={(e) =>
                        patchNode(node.id, { days: parseInt(e.target.value) || 0 })
                      }
                      className="w-20 border border-neutral-300 rounded px-2 py-1.5"
                    />
                    <span className="text-neutral-500">days before the next step</span>
                  </div>
                </>
              )}
              {node?.type === "branch" && (
                <>
                  <div className="text-[10px] tracking-wide text-neutral-400 mb-1.5">BRANCH</div>
                  <select
                    value={node.data.condition ?? "not_visited_since_entry"}
                    onChange={(e) =>
                      patchNode(node.id, { condition: e.target.value as BranchCondition })
                    }
                    className="border border-neutral-300 rounded px-2 py-1.5 text-sm bg-white"
                  >
                    <option value="not_visited_since_entry">
                      Still away since entering? (Yes = no visit)
                    </option>
                    <option value="visited_since_entry">
                      Visited since entering? (Yes = came back)
                    </option>
                  </select>
                </>
              )}
              {node?.type === "message" && (
                <>
                  <div className="text-[10px] tracking-wide text-neutral-400 mb-1.5">
                    MESSAGE DRAFT → ACTION INBOX
                  </div>
                  <div className="flex flex-wrap items-center gap-2 mb-2">
                    <select
                      value={node.data.channel ?? "whatsapp"}
                      onChange={(e) =>
                        patchNode(node.id, { channel: e.target.value as CampaignChannel })
                      }
                      className="border border-neutral-300 rounded px-2 py-1 text-xs bg-white"
                    >
                      <option value="whatsapp">WhatsApp</option>
                      <option value="email">Email</option>
                    </select>
                    <select
                      value={node.data.offerCampaignId ?? ""}
                      onChange={(e) => {
                        const c = offerCampaigns.find((x) => x.id === e.target.value);
                        patchNode(node.id, {
                          offerCampaignId: c?.id ?? null,
                          offerCode: c?.offer_code ?? null,
                        });
                      }}
                      className="border border-neutral-300 rounded px-2 py-1 text-xs bg-white"
                    >
                      <option value="">No offer attached</option>
                      {offerCampaigns.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.offer_code} ({c.name})
                        </option>
                      ))}
                    </select>
                    <span className="flex items-center gap-1">
                      {VARIABLES.map((v) => (
                        <button
                          key={v}
                          onClick={() =>
                            patchNode(node.id, { body: `${node.data.body ?? ""}${v}` })
                          }
                          title={
                            v === "{{code}}" && !node.data.offerCode
                              ? "Attach an offer to use the code"
                              : `Insert ${v}`
                          }
                          className="text-[10px] font-mono bg-blue-50 text-blue-700 rounded px-1.5 py-0.5 hover:bg-blue-100"
                        >
                          {v}
                        </button>
                      ))}
                    </span>
                  </div>
                  <textarea
                    value={node.data.body ?? ""}
                    onChange={(e) => patchNode(node.id, { body: e.target.value })}
                    rows={2}
                    placeholder="Hi {{name}}! …"
                    className="w-full border border-neutral-300 rounded px-2 py-1.5 text-sm"
                  />
                </>
              )}
            </div>

            <div
              className={`rounded-xl p-3 text-xs ${
                problems.length === 0
                  ? "bg-green-50 text-green-800"
                  : "bg-amber-50 text-amber-800"
              }`}
            >
              {problems.length === 0 ? (
                <>
                  <div className="font-medium mb-1">✓ Valid flow</div>
                  One trigger · every node connected · branches wired · loops pause
                </>
              ) : (
                <>
                  <div className="font-medium mb-1">Before launch:</div>
                  <ul className="list-disc pl-4 space-y-0.5">
                    {problems.map((p) => (
                      <li key={p}>{p}</li>
                    ))}
                  </ul>
                </>
              )}
            </div>
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
                  <span className="text-sm text-green-700">{statusChip(selected).text}</span>
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
                    disabled={busy || problems.length > 0}
                    title={problems.length > 0 ? problems[0] : undefined}
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
            onChange={(e) => onChange({ ...entry, days: parseInt(e.target.value) || 1 })}
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
