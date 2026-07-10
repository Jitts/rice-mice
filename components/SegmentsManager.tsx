"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { formatCents } from "@/lib/format";
import { profilesToCsv, downloadText } from "@/lib/segmentExport";
import { SegmentBuilder, paletteDragProps } from "@/components/SegmentBuilder";
import {
  buildProfiles,
  collectOptions,
  filterProfiles,
  isReachable,
  journeyCounts,
  newCondition,
  stageOf,
  EMPTY_DEFINITION,
  FIELD_LIST,
  JOURNEY_LABELS,
  JOURNEY_ORDER,
  type CustomerRow,
  type JourneyStage,
  type SegmentDefinition,
} from "@/lib/segments";
import type { Order } from "@/lib/orders";

export type SavedSegment = {
  id: string;
  name: string;
  definition: SegmentDefinition;
  is_starter: boolean;
  updated_at: string;
};

const STAGE_STYLES: Record<JourneyStage, string> = {
  new: "bg-blue-50 text-blue-700",
  active: "bg-emerald-50 text-emerald-700",
  loyal: "bg-violet-50 text-violet-700",
  at_risk: "bg-amber-50 text-amber-700",
  churned: "bg-neutral-100 text-neutral-600",
};

function slug(name: string) {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "segment";
}

export function SegmentsManager({
  initialCustomers,
  initialOrders,
  itemNames,
  initialSegments,
}: {
  initialCustomers: CustomerRow[];
  initialOrders: Order[];
  itemNames: string[];
  initialSegments: SavedSegment[];
}) {
  const [supabase] = useState(() => createClient());
  const [segments, setSegments] = useState<SavedSegment[]>(initialSegments);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [definition, setDefinition] = useState<SegmentDefinition>(EMPTY_DEFINITION);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const profiles = useMemo(
    () => buildProfiles(initialCustomers, initialOrders),
    [initialCustomers, initialOrders],
  );
  const options = useMemo(() => collectOptions(profiles, itemNames), [profiles, itemNames]);
  const journey = useMemo(() => journeyCounts(profiles), [profiles]);

  const matched = useMemo(() => filterProfiles(definition, profiles), [definition, profiles]);
  const reachable = useMemo(() => matched.filter(isReachable), [matched]);

  function loadSegment(seg: SavedSegment) {
    setSelectedId(seg.id);
    setName(seg.name);
    setDefinition(seg.definition ?? EMPTY_DEFINITION);
    setStatus(null);
  }

  function newSegment() {
    setSelectedId(null);
    setName("");
    setDefinition(EMPTY_DEFINITION);
    setStatus(null);
  }

  function addFieldToRoot(field: string) {
    setDefinition((d) => {
      const nd = structuredClone(d);
      nd.children.push(newCondition(field));
      return nd;
    });
  }

  async function save() {
    setBusy(true);
    setStatus(null);
    const cleanName = name.trim() || "Untitled segment";
    if (selectedId) {
      const { error } = await supabase
        .from("segments")
        .update({ name: cleanName, definition, updated_at: new Date().toISOString() })
        .eq("id", selectedId);
      setBusy(false);
      if (error) return setStatus("Couldn't save — try again.");
      setSegments((list) =>
        list.map((s) => (s.id === selectedId ? { ...s, name: cleanName, definition } : s)),
      );
      setStatus("Saved.");
    } else {
      const id = crypto.randomUUID();
      const { error } = await supabase
        .from("segments")
        .insert({ id, name: cleanName, definition });
      setBusy(false);
      if (error) return setStatus("Couldn't save — try again.");
      setSegments((list) => [
        { id, name: cleanName, definition, is_starter: false, updated_at: new Date().toISOString() },
        ...list,
      ]);
      setSelectedId(id);
      setStatus("Saved.");
    }
  }

  async function remove(seg: SavedSegment) {
    if (!window.confirm(`Delete segment “${seg.name}”?`)) return;
    setBusy(true);
    const { error } = await supabase.from("segments").delete().eq("id", seg.id);
    setBusy(false);
    if (error) return setStatus("Couldn't delete — try again.");
    setSegments((list) => list.filter((s) => s.id !== seg.id));
    if (selectedId === seg.id) newSegment();
  }

  function exportCsv() {
    if (matched.length === 0) return;
    downloadText(`${slug(name)}.csv`, profilesToCsv(matched));
  }

  return (
    <main className="min-h-screen p-8 max-w-6xl mx-auto space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Customer segments</h1>
        <nav className="flex gap-4 text-sm text-neutral-500">
          <Link href="/dashboard" className="underline">Dashboard</Link>
          <Link href="/dashboard/orders" className="underline">Order pad</Link>
          <Link href="/dashboard/items" className="underline">Menu items</Link>
          <Link href="/dashboard/campaigns" className="underline">Campaigns</Link>
        </nav>
      </div>

      <section>
        <h2 className="text-xs uppercase tracking-wide text-neutral-400 mb-2">
          Customer journey
        </h2>
        <div className="flex items-stretch gap-2 overflow-x-auto">
          {JOURNEY_ORDER.map((stage, i) => (
            <div key={stage} className="flex items-center gap-2">
              <div className={`rounded-lg px-4 py-2 min-w-[92px] ${STAGE_STYLES[stage]}`}>
                <div className="text-xs">{JOURNEY_LABELS[stage]}</div>
                <div className="text-xl font-semibold">{journey[stage]}</div>
              </div>
              {i < JOURNEY_ORDER.length - 1 && <span className="text-neutral-300">→</span>}
            </div>
          ))}
        </div>
      </section>

      <div className="grid grid-cols-1 md:grid-cols-[210px_1fr] gap-6">
        <aside className="space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Saved segments</h2>
            <button onClick={newSegment} className="text-xs text-blue-600 hover:underline">
              + New
            </button>
          </div>
          {segments.length === 0 && (
            <p className="text-xs text-neutral-400">No saved segments yet.</p>
          )}
          {segments.map((seg) => {
            const count = filterProfiles(seg.definition ?? EMPTY_DEFINITION, profiles).length;
            const active = seg.id === selectedId;
            return (
              <div
                key={seg.id}
                className={`rounded-lg border px-3 py-2 cursor-pointer ${
                  active ? "border-neutral-900 bg-neutral-50" : "border-neutral-200 bg-white"
                }`}
                onClick={() => loadSegment(seg)}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm truncate">{seg.name}</span>
                  <span className="text-sm font-semibold">{count}</span>
                </div>
                <div className="flex items-center justify-between mt-1">
                  {seg.is_starter ? (
                    <span className="text-[10px] uppercase tracking-wide text-neutral-400">
                      Starter
                    </span>
                  ) : (
                    <span />
                  )}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      remove(seg);
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
            placeholder="Segment name (e.g. Win-back big spenders)"
            className="w-full border border-neutral-300 rounded px-3 py-2 text-lg font-medium"
          />

          <div className="grid grid-cols-1 sm:grid-cols-[160px_1fr] gap-4">
            <div>
              <h3 className="text-xs uppercase tracking-wide text-neutral-400 mb-2">
                Criteria
              </h3>
              <div className="flex flex-wrap sm:flex-col gap-1.5">
                {FIELD_LIST.map((f) => (
                  <button
                    key={f.id}
                    {...paletteDragProps(f.id)}
                    onClick={() => addFieldToRoot(f.id)}
                    className="text-left text-xs bg-white border border-neutral-200 rounded px-2 py-1.5 hover:border-neutral-400 cursor-grab active:cursor-grabbing"
                    title="Drag onto a group, or click to add"
                  >
                    <span className="text-neutral-400 mr-1" aria-hidden>⠿</span>
                    {f.label}
                  </button>
                ))}
              </div>
            </div>

            <SegmentBuilder definition={definition} onChange={setDefinition} options={options} />
          </div>

          <div className="rounded-lg border border-neutral-200 bg-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-6">
                <div>
                  <div className="text-xs text-neutral-500">Matches</div>
                  <div className="text-2xl font-semibold">{matched.length}</div>
                </div>
                <div>
                  <div className="text-xs text-neutral-500">Reachable (opted in)</div>
                  <div className="text-2xl font-semibold text-emerald-600">{reachable.length}</div>
                </div>
                <div className="flex -space-x-2">
                  {matched.slice(0, 6).map((p) => (
                    <span
                      key={p.id}
                      className="w-8 h-8 rounded-full bg-neutral-200 text-neutral-700 text-xs flex items-center justify-center border border-white"
                      title={`${p.firstName} ${p.lastName}`}
                    >
                      {p.firstName[0]}
                      {p.lastName[0]}
                    </span>
                  ))}
                  {matched.length > 6 && (
                    <span className="w-8 h-8 rounded-full bg-neutral-100 text-neutral-500 text-xs flex items-center justify-center border border-white">
                      +{matched.length - 6}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={exportCsv}
                  disabled={matched.length === 0}
                  className="text-sm border border-neutral-300 rounded px-3 py-1.5 disabled:opacity-40"
                >
                  Export matched (CSV)
                </button>
                {selectedId && (
                  <Link
                    href={`/dashboard/campaigns/new?segment=${selectedId}`}
                    className="text-sm border border-neutral-300 rounded px-3 py-1.5"
                  >
                    Create campaign
                  </Link>
                )}
                <button
                  onClick={save}
                  disabled={busy}
                  className="text-sm bg-neutral-900 text-white rounded px-3 py-1.5 disabled:opacity-50"
                >
                  {busy ? "Saving…" : selectedId ? "Save changes" : "Save segment"}
                </button>
              </div>
            </div>
            {status && <p className="text-xs text-neutral-500 mt-2">{status}</p>}
            <p className="text-[11px] text-neutral-400 mt-2">
              Save the segment to start a campaign from it. Only opted-in customers can
              receive one, and every message is sent by a person — never automatically.
            </p>
          </div>

          {matched.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="text-left border-b text-neutral-500">
                    <th className="py-2 font-medium">Customer</th>
                    <th className="py-2 font-medium">Stage</th>
                    <th className="py-2 font-medium">Spent</th>
                    <th className="py-2 font-medium">Orders</th>
                    <th className="py-2 font-medium">Reachable</th>
                  </tr>
                </thead>
                <tbody>
                  {matched.slice(0, 30).map((p) => (
                    <tr key={p.id} className="border-b">
                      <td className="py-2">
                        {p.firstName} {p.lastName}
                      </td>
                      <td className="py-2">
                        <span className={`text-xs rounded-full px-2 py-0.5 ${STAGE_STYLES[stageOf(p)]}`}>
                          {JOURNEY_LABELS[stageOf(p)]}
                        </span>
                      </td>
                      <td className="py-2">{formatCents(p.totalSpentCents)}</td>
                      <td className="py-2">{p.orderCount}</td>
                      <td className="py-2">
                        {isReachable(p) ? (
                          <span className="text-emerald-600">Yes</span>
                        ) : (
                          <span className="text-neutral-400">No</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {matched.length > 30 && (
                <p className="text-xs text-neutral-400 mt-2">
                  Showing 30 of {matched.length}. Export for the full list.
                </p>
              )}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
