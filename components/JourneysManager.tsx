"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import {
  buildFieldRegistry,
  buildProfiles,
  filterProfiles,
  type CustomFieldRow,
  type CustomerRow,
} from "@/lib/segments";
import {
  validateGraph,
  journeyWithTrigger,
  EMPTY_JOURNEY,
  type BranchCondition,
  type Journey,
  type JourneyDefinition,
} from "@/lib/journeys";
import { runJourneyTick } from "@/lib/journeyExecutor";
import { attributeCampaign, type SentLog } from "@/lib/attribution";
import { formatCents } from "@/lib/format";
import { JourneyCanvas, type JourneyCanvasHandle } from "@/components/JourneyCanvas";
import { InfoTip } from "@/components/InfoTip";
import { useRules } from "@/components/RulesContext";
import type { CampaignChannel } from "@/lib/campaigns";
import type { Order } from "@/lib/orders";
import type { SavedSegment } from "@/components/SegmentsManager";

export type RunStub = { id: string; journey_id: string; status: string };
export type OfferCampaign = { id: string; name: string; offer_code: string };
export type JourneyLogRow = SentLog & { journey_id: string | null };

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
      return { text: "Window ended", cls: "bg-muted text-muted-foreground" };
    return {
      text: j.run_until
        ? `Running until ${new Date(j.run_until).toLocaleDateString()}`
        : "Running · evergreen",
      cls: "bg-green-100 dark:bg-green-950/50 text-green-700 dark:text-green-300",
    };
  }
  if (j.status === "stopped") return { text: "Stopped", cls: "bg-amber-100 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300" };
  return { text: "Draft", cls: "bg-muted text-muted-foreground" };
}

function isGraph(def: unknown): def is JourneyDefinition {
  return !!def && typeof def === "object" && Array.isArray((def as JourneyDefinition).nodes);
}

export function JourneysManager({
  initialJourneys,
  initialCustomers,
  initialOrders,
  initialRuns,
  initialSegments,
  initialCustomFields,
  initialLogs,
  offerCampaigns,
  initialSegmentId,
}: {
  initialJourneys: Journey[];
  initialCustomers: CustomerRow[];
  initialOrders: Order[];
  initialRuns: RunStub[];
  initialSegments: SavedSegment[];
  initialCustomFields: CustomFieldRow[];
  initialLogs: JourneyLogRow[];
  offerCampaigns: OfferCampaign[];
  initialSegmentId?: string;
}) {
  const [supabase] = useState(() => createClient());
  const rules = useRules();
  const [journeys, setJourneys] = useState<Journey[]>(initialJourneys);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const preselected = initialSegments.find((s) => s.id === initialSegmentId);
  const [name, setName] = useState("");
  const [definition, setDefinition] = useState<JourneyDefinition>(() =>
    preselected ? journeyWithTrigger(preselected.id, preselected.name) : structuredClone(EMPTY_JOURNEY),
  );
  const [selectedNode, setSelectedNode] = useState<string | null>("trigger");
  const [duration, setDuration] = useState(30);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [newNonce, setNewNonce] = useState(0);
  const canvasRef = useRef<JourneyCanvasHandle>(null);

  useEffect(() => {
    runJourneyTick(supabase).catch(() => {});
  }, [supabase]);

  const profiles = useMemo(
    () => buildProfiles(initialCustomers, initialOrders),
    [initialCustomers, initialOrders],
  );
  const fieldRegistry = useMemo(
    () => buildFieldRegistry(initialCustomFields),
    [initialCustomFields],
  );
  const segmentsById = useMemo(
    () => Object.fromEntries(initialSegments.map((s) => [s.id, s.definition])),
    [initialSegments],
  );
  const validSegmentIds = useMemo(
    () => new Set(initialSegments.map((s) => s.id)),
    [initialSegments],
  );

  const trigger = definition.nodes.find((n) => n.type === "trigger");
  const triggerSegmentDef = trigger?.data.segmentId ? segmentsById[trigger.data.segmentId] : null;
  const matchCount = useMemo(
    () =>
      triggerSegmentDef
        ? filterProfiles(triggerSegmentDef, profiles, fieldRegistry.byId, segmentsById).length
        : 0,
    [triggerSegmentDef, profiles, fieldRegistry, segmentsById],
  );
  const problems = useMemo(
    () => validateGraph(definition, validSegmentIds),
    [definition, validSegmentIds],
  );
  const activeRunCount = (id: string) =>
    initialRuns.filter((r) => r.journey_id === id && r.status === "active").length;

  const logsByJourney = useMemo(() => {
    const map = new Map<string, SentLog[]>();
    for (const l of initialLogs) {
      if (!l.journey_id) continue;
      const list = map.get(l.journey_id) ?? [];
      list.push(l);
      map.set(l.journey_id, list);
    }
    return map;
  }, [initialLogs]);

  const selected = journeys.find((j) => j.id === selectedId) ?? null;
  const node = definition.nodes.find((n) => n.id === selectedNode) ?? null;
  const results = useMemo(
    () =>
      selected
        ? attributeCampaign(
            logsByJourney.get(selected.id) ?? [],
            initialOrders,
            rules.attribution_window_days,
          )
        : null,
    [selected, logsByJourney, initialOrders, rules],
  );

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
    setNewNonce((n) => n + 1); // forces the canvas to remount with a clean graph
  }

  // Routed through the canvas's own local node state (via ref) rather than
  // this component's `definition` directly — keeps a single source of truth
  // for the graph so panel edits and drag/connect gestures never fight.
  function patchNode(id: string, data: Partial<JourneyDefinition["nodes"][number]["data"]>) {
    canvasRef.current?.patchNode(id, data);
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
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Draw a flow on the canvas, launch it for a period (or evergreen), and it
        prepares message drafts into the action inbox — people always press send.
      </p>

      <div className="grid grid-cols-1 lg:grid-cols-[220px_minmax(0,1fr)] gap-6">
        <aside className="space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Your journeys</h2>
            <button onClick={newJourney} className="text-xs text-blue-600 dark:text-blue-400 hover:underline">
              + New
            </button>
          </div>
          {journeys.length === 0 && (
            <p className="text-xs text-muted-foreground/70">Nothing yet — draw your first flow.</p>
          )}
          {journeys.map((j) => {
            const chip = statusChip(j);
            return (
              <div
                key={j.id}
                onClick={() => load(j)}
                className={`rounded-lg border px-3 py-2 cursor-pointer ${
                  j.id === selectedId
                    ? "border-primary bg-muted"
                    : "border-border bg-card"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm truncate">{j.name}</span>
                  <span className="text-xs text-muted-foreground">{activeRunCount(j.id)} in</span>
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
                    className="text-[11px] text-muted-foreground/70 hover:text-destructive"
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
            className="w-full border border-input rounded px-3 py-2 text-lg font-medium"
          />

          <JourneyCanvas
            key={selectedId ?? `new-${newNonce}`}
            ref={canvasRef}
            definition={definition}
            onChange={(part) =>
              setDefinition((d) => ({ ...d, nodes: part.nodes, edges: part.edges }))
            }
            onSelect={setSelectedNode}
          />

          <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_240px] gap-3 items-start">
            <div className="rounded-xl border border-border bg-card p-3 min-h-[92px]">
              {!node && (
                <p className="text-xs text-muted-foreground/70">
                  Select a node on the canvas to edit it.
                </p>
              )}
              {node?.type === "trigger" && (
                <>
                  <div className="text-[10px] tracking-wide text-muted-foreground/70 mb-1.5">
                    TRIGGER — WHO ENTERS WHILE RUNNING
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="text-muted-foreground">Audience</span>
                    <select
                      value={node.data.segmentId ?? ""}
                      onChange={(e) => {
                        const seg = initialSegments.find((s) => s.id === e.target.value);
                        patchNode(node.id, {
                          segmentId: seg?.id,
                          segmentName: seg?.name,
                        });
                      }}
                      className="border border-input rounded px-2 py-1.5 bg-card"
                    >
                      <option value="">Choose a segment…</option>
                      {initialSegments.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                    <Link
                      href="/dashboard/segments"
                      className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
                    >
                      + New segment
                    </Link>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1.5">
                    {matchCount} customer{matchCount === 1 ? "" : "s"} would qualify right
                    now · each customer enters once
                  </p>
                </>
              )}
              {node?.type === "wait" && (
                <>
                  <div className="text-[10px] tracking-wide text-muted-foreground/70 mb-1.5">WAIT</div>
                  <div className="flex items-center gap-2 text-sm">
                    <input
                      type="number"
                      min={0}
                      value={node.data.days ?? 0}
                      onChange={(e) =>
                        patchNode(node.id, { days: parseInt(e.target.value) || 0 })
                      }
                      className="w-20 border border-input rounded px-2 py-1.5"
                    />
                    <span className="text-muted-foreground">days before the next step</span>
                  </div>
                </>
              )}
              {node?.type === "branch" && (
                <>
                  <div className="text-[10px] tracking-wide text-muted-foreground/70 mb-1.5">BRANCH</div>
                  <select
                    value={node.data.condition ?? "not_visited_since_entry"}
                    onChange={(e) =>
                      patchNode(node.id, { condition: e.target.value as BranchCondition })
                    }
                    className="border border-input rounded px-2 py-1.5 text-sm bg-card"
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
                  <div className="text-[10px] tracking-wide text-muted-foreground/70 mb-1.5">
                    MESSAGE DRAFT → ACTION INBOX
                  </div>
                  <div className="flex flex-wrap items-center gap-2 mb-2">
                    <select
                      value={node.data.channel ?? "whatsapp"}
                      onChange={(e) =>
                        patchNode(node.id, { channel: e.target.value as CampaignChannel })
                      }
                      className="border border-input rounded px-2 py-1 text-xs bg-card"
                    >
                      <option value="whatsapp">WhatsApp</option>
                      <option value="email">Email (EDM)</option>
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
                      className="border border-input rounded px-2 py-1 text-xs bg-card"
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
                          className="text-[10px] font-mono bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 rounded px-1.5 py-0.5 hover:bg-blue-100 dark:hover:bg-blue-950/50"
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
                    className="w-full border border-input rounded px-2 py-1.5 text-sm"
                  />
                </>
              )}
            </div>

            <div
              className={`rounded-xl p-3 text-xs ${
                problems.length === 0
                  ? "bg-green-50 dark:bg-green-950/40 text-green-800 dark:text-green-200"
                  : "bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-200"
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

          {selected && results && results.sentCount > 0 && (
            <div className="rounded-xl border border-border bg-card p-4">
              <div className="flex items-baseline justify-between mb-3">
                <h2 className="text-sm font-semibold">Results</h2>
                <span className="text-xs text-muted-foreground/70">
                  same measurement as one-time campaigns
                </span>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <p className="text-xs text-muted-foreground">
                    Sent
                    <InfoTip term="sent" align="left" />
                  </p>
                  <p className="text-2xl font-semibold tracking-tight">{results.sentCount}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">
                    Came back
                    <InfoTip term="came_back" />
                  </p>
                  <p className="text-2xl font-semibold tracking-tight">
                    {results.returnedCount}
                    <span className="text-sm font-normal text-muted-foreground/70 ml-1">
                      ({Math.round((results.returnedCount / results.sentCount) * 100)}%)
                    </span>
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">
                    Revenue after send
                    <InfoTip term="revenue_after_send" align="right" />
                  </p>
                  <p className="text-2xl font-semibold tracking-tight text-emerald-600 dark:text-emerald-400">
                    {formatCents(results.attributedCents)}
                  </p>
                </div>
              </div>
            </div>
          )}

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

          <div className="rounded-xl border border-border bg-card p-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              {selected?.status === "running" ? (
                <>
                  <span className="text-sm text-green-700 dark:text-green-300">{statusChip(selected).text}</span>
                  <button
                    onClick={stop}
                    disabled={busy}
                    className="text-sm border border-input rounded px-3 py-1.5 disabled:opacity-50"
                  >
                    Stop journey
                  </button>
                </>
              ) : (
                <>
                  <label className="text-xs text-muted-foreground">Run for</label>
                  <select
                    value={duration}
                    onChange={(e) => setDuration(parseInt(e.target.value))}
                    className="border border-input rounded px-2 py-1.5 text-sm"
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
                    className="text-sm bg-primary text-primary-foreground rounded px-4 py-1.5 disabled:opacity-40"
                  >
                    {busy ? "Working…" : "Launch"}
                  </button>
                </>
              )}
            </div>
            <button
              onClick={save}
              disabled={busy}
              className="text-sm border border-input rounded px-3 py-1.5 disabled:opacity-50"
            >
              {selectedId ? "Save changes" : "Save draft"}
            </button>
          </div>
          {note && <p className="text-xs text-muted-foreground">{note}</p>}
        </section>
      </div>
    </div>
  );
}
