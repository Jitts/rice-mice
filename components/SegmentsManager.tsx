"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { formatCents } from "@/lib/format";
import { profilesToCsv, downloadText } from "@/lib/segmentExport";
import { InfoTip } from "@/components/InfoTip";
import { SegmentBuilder, paletteDragProps, segmentRefDragProps } from "@/components/SegmentBuilder";
import {
  buildFieldRegistry,
  buildProfiles,
  collectOptions,
  filterProfiles,
  isReachable,
  journeyCounts,
  newCondition,
  newSegmentRef,
  stageOf,
  EMPTY_DEFINITION,
  JOURNEY_LABELS,
  JOURNEY_ORDER,
  type CustomFieldRow,
  type CustomFieldValueType,
  type CustomerRow,
  type JourneyStage,
  type SegmentDefinition,
} from "@/lib/segments";
import { useRules } from "@/components/RulesContext";
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
  churned: "bg-muted text-muted-foreground",
};

const CUSTOM_FIELD_TYPES: { value: CustomFieldValueType; label: string }[] = [
  { value: "text", label: "Text" },
  { value: "number", label: "Number" },
  { value: "boolean", label: "Yes / no" },
  { value: "date", label: "Date" },
];

function slug(name: string) {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "segment";
}

export function SegmentsManager({
  initialCustomers,
  initialOrders,
  itemNames,
  initialSegments,
  initialCustomFields,
}: {
  initialCustomers: CustomerRow[];
  initialOrders: Order[];
  itemNames: string[];
  initialSegments: SavedSegment[];
  initialCustomFields: CustomFieldRow[];
}) {
  const [supabase] = useState(() => createClient());
  const rules = useRules();
  const [segments, setSegments] = useState<SavedSegment[]>(initialSegments);
  const [customFields, setCustomFields] = useState<CustomFieldRow[]>(initialCustomFields);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [definition, setDefinition] = useState<SegmentDefinition>(EMPTY_DEFINITION);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const [addingField, setAddingField] = useState(false);
  const [newFieldLabel, setNewFieldLabel] = useState("");
  const [newFieldType, setNewFieldType] = useState<CustomFieldValueType>("text");
  const [fieldStatus, setFieldStatus] = useState<string | null>(null);

  const profiles = useMemo(
    () => buildProfiles(initialCustomers, initialOrders),
    [initialCustomers, initialOrders],
  );
  const options = useMemo(() => collectOptions(profiles, itemNames), [profiles, itemNames]);
  const journey = useMemo(() => journeyCounts(profiles, rules), [profiles, rules]);
  const fieldRegistry = useMemo(() => buildFieldRegistry(customFields), [customFields]);

  // Every saved segment's definition, keyed by id — how "merge/exclude" nodes
  // resolve the segment they point at.
  const segmentsById = useMemo(
    () => Object.fromEntries(segments.map((s) => [s.id, s.definition ?? EMPTY_DEFINITION])),
    [segments],
  );
  // A segment can't reference itself; offer every other saved segment as a target.
  const segmentOptions = useMemo(
    () => segments.filter((s) => s.id !== selectedId).map((s) => ({ id: s.id, name: s.name })),
    [segments, selectedId],
  );

  const matched = useMemo(
    () => filterProfiles(definition, profiles, fieldRegistry.byId, segmentsById),
    [definition, profiles, fieldRegistry, segmentsById],
  );
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
      nd.children.push(newCondition(field, fieldRegistry.byId));
      return nd;
    });
  }

  function addSegmentRefToRoot() {
    const other = segments.find((s) => s.id !== selectedId);
    if (!other) return;
    setDefinition((d) => {
      const nd = structuredClone(d);
      nd.children.push(newSegmentRef(other.id, "include"));
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

  async function duplicate(seg: SavedSegment) {
    setBusy(true);
    const id = crypto.randomUUID();
    const copyName = `${seg.name} (copy)`;
    const { error } = await supabase
      .from("segments")
      .insert({ id, name: copyName, definition: seg.definition });
    setBusy(false);
    if (error) return setStatus("Couldn't duplicate — try again.");
    const copy: SavedSegment = {
      id,
      name: copyName,
      definition: seg.definition,
      is_starter: false,
      updated_at: new Date().toISOString(),
    };
    setSegments((list) => [copy, ...list]);
    loadSegment(copy);
  }

  async function addCustomField() {
    const label = newFieldLabel.trim();
    if (!label) return;
    setFieldStatus(null);
    const key = slug(label);
    if (customFields.some((f) => f.key === key)) {
      setFieldStatus("A criterion with that name already exists.");
      return;
    }
    const id = crypto.randomUUID();
    const row: CustomFieldRow = {
      id,
      key,
      label,
      value_type: newFieldType,
      sort_order: customFields.length,
    };
    const { error } = await supabase.from("custom_fields").insert(row);
    if (error) {
      setFieldStatus(
        error.code === "23505" ? "That name is already used." : "Couldn't add — try again.",
      );
      return;
    }
    setCustomFields((list) => [...list, row]);
    setNewFieldLabel("");
    setAddingField(false);
  }

  function exportCsv() {
    if (matched.length === 0) return;
    downloadText(`${slug(name)}.csv`, profilesToCsv(matched, rules));
  }

  return (
    <div className="max-w-6xl mx-auto space-y-8">
      <h1 className="font-heading text-2xl font-bold tracking-tight">Customer segments</h1>

      <section>
        <h2 className="text-xs uppercase tracking-wide text-muted-foreground/70 mb-2">
          Customer journey
          <InfoTip term="journey_stages" align="left" />
        </h2>
        <div className="flex items-stretch gap-2 overflow-x-auto">
          {JOURNEY_ORDER.map((stage, i) => (
            <div key={stage} className="flex items-center gap-2">
              <div className={`rounded-lg px-4 py-2 min-w-[92px] ${STAGE_STYLES[stage]}`}>
                <div className="text-xs">{JOURNEY_LABELS[stage]}</div>
                <div className="text-xl font-semibold">{journey[stage]}</div>
              </div>
              {i < JOURNEY_ORDER.length - 1 && <span className="text-muted-foreground/50">→</span>}
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
            <p className="text-xs text-muted-foreground/70">No saved segments yet.</p>
          )}
          {segments.map((seg) => {
            const count = filterProfiles(
              seg.definition ?? EMPTY_DEFINITION,
              profiles,
              fieldRegistry.byId,
              segmentsById,
            ).length;
            const active = seg.id === selectedId;
            return (
              <div
                key={seg.id}
                className={`rounded-lg border px-3 py-2 cursor-pointer ${
                  active ? "border-primary bg-muted" : "border-border bg-card"
                }`}
                onClick={() => loadSegment(seg)}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm truncate">{seg.name}</span>
                  <span className="text-sm font-semibold">{count}</span>
                </div>
                <div className="flex items-center justify-between mt-1 gap-2">
                  {seg.is_starter ? (
                    <span className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
                      Starter
                    </span>
                  ) : (
                    <span />
                  )}
                  <div className="flex items-center gap-2">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        duplicate(seg);
                      }}
                      className="text-[11px] text-muted-foreground/70 hover:text-foreground/80"
                    >
                      duplicate
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        remove(seg);
                      }}
                      className="text-[11px] text-muted-foreground/70 hover:text-destructive"
                    >
                      delete
                    </button>
                  </div>
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
            className="w-full border border-input rounded px-3 py-2 text-lg font-medium"
          />

          <div className="grid grid-cols-1 sm:grid-cols-[180px_1fr] gap-4">
            <div>
              <h3 className="text-xs uppercase tracking-wide text-muted-foreground/70 mb-2">
                Criteria
              </h3>
              <div className="flex flex-wrap sm:flex-col gap-1.5">
                {fieldRegistry.list.map((f) => (
                  <button
                    key={f.id}
                    {...paletteDragProps(f.id)}
                    onClick={() => addFieldToRoot(f.id)}
                    className="text-left text-xs bg-card border border-border rounded px-2 py-1.5 hover:border-ring cursor-grab active:cursor-grabbing"
                    title="Drag onto a group, or click to add"
                  >
                    <span className="text-muted-foreground/70 mr-1" aria-hidden>⠿</span>
                    {f.label}
                    {f.custom && <span className="text-muted-foreground/70"> (custom)</span>}
                  </button>
                ))}
                {segments.length > 1 && (
                  <button
                    {...segmentRefDragProps()}
                    onClick={addSegmentRefToRoot}
                    className="text-left text-xs bg-violet-50 border border-violet-200 rounded px-2 py-1.5 hover:border-violet-400 cursor-grab active:cursor-grabbing text-violet-700"
                    title="Drag onto a group, or click to add — include or exclude another saved segment"
                  >
                    <span className="text-violet-300 mr-1" aria-hidden>⠿</span>
                    Saved segment
                  </button>
                )}
              </div>

              {addingField ? (
                <div className="mt-3 space-y-1.5 border border-border rounded-lg p-2 bg-muted">
                  <input
                    autoFocus
                    value={newFieldLabel}
                    onChange={(e) => setNewFieldLabel(e.target.value)}
                    placeholder="Criterion name"
                    className="w-full text-xs border border-input rounded px-2 py-1"
                  />
                  <select
                    value={newFieldType}
                    onChange={(e) => setNewFieldType(e.target.value as CustomFieldValueType)}
                    className="w-full text-xs border border-input rounded bg-card px-2 py-1"
                  >
                    {CUSTOM_FIELD_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                  <div className="flex gap-2">
                    <button
                      onClick={addCustomField}
                      className="text-xs bg-primary text-primary-foreground rounded px-2 py-1"
                    >
                      Add
                    </button>
                    <button
                      onClick={() => {
                        setAddingField(false);
                        setFieldStatus(null);
                      }}
                      className="text-xs text-muted-foreground"
                    >
                      Cancel
                    </button>
                  </div>
                  {fieldStatus && <p className="text-[11px] text-destructive">{fieldStatus}</p>}
                </div>
              ) : (
                <button
                  onClick={() => setAddingField(true)}
                  className="mt-2 text-xs text-blue-600 hover:underline"
                >
                  + New criteria
                </button>
              )}
            </div>

            <SegmentBuilder
              definition={definition}
              onChange={setDefinition}
              options={options}
              fields={fieldRegistry.list}
              fieldsById={fieldRegistry.byId}
              segmentOptions={segmentOptions}
            />
          </div>

          <div className="rounded-lg border border-border bg-card p-4">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-6">
                <div>
                  <div className="text-xs text-muted-foreground">
                    Matches
                    <InfoTip term="matches" align="left" />
                  </div>
                  <div className="text-2xl font-semibold">{matched.length}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">
                    Reachable (opted in)
                    <InfoTip term="reachable" align="left" />
                  </div>
                  <div className="text-2xl font-semibold text-emerald-600">{reachable.length}</div>
                </div>
                <div className="flex -space-x-2">
                  {matched.slice(0, 6).map((p) => (
                    <span
                      key={p.id}
                      className="w-8 h-8 rounded-full bg-muted text-foreground/80 text-xs flex items-center justify-center border border-background"
                      title={`${p.firstName} ${p.lastName}`}
                    >
                      {p.firstName[0]}
                      {p.lastName[0]}
                    </span>
                  ))}
                  {matched.length > 6 && (
                    <span className="w-8 h-8 rounded-full bg-muted text-muted-foreground text-xs flex items-center justify-center border border-background">
                      +{matched.length - 6}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={exportCsv}
                  disabled={matched.length === 0}
                  className="text-sm border border-input rounded px-3 py-1.5 disabled:opacity-40"
                >
                  Export matched (CSV)
                </button>
                {selectedId && (
                  <>
                    <Link
                      href={`/dashboard/campaigns/new?segment=${selectedId}`}
                      className="text-sm border border-input rounded px-3 py-1.5"
                    >
                      Create campaign
                    </Link>
                    <Link
                      href={`/dashboard/campaigns?tab=journeys&segment=${selectedId}`}
                      className="text-sm border border-input rounded px-3 py-1.5"
                    >
                      Create journey
                    </Link>
                  </>
                )}
                <button
                  onClick={save}
                  disabled={busy}
                  className="text-sm bg-primary text-primary-foreground rounded px-3 py-1.5 disabled:opacity-50"
                >
                  {busy ? "Saving…" : selectedId ? "Save changes" : "Save segment"}
                </button>
              </div>
            </div>
            {status && <p className="text-xs text-muted-foreground mt-2">{status}</p>}
            <p className="text-[11px] text-muted-foreground/70 mt-2">
              Save the segment to start a campaign from it, reference it from another
              segment, or duplicate it. Only opted-in customers can receive a campaign,
              and every message is sent by a person — never automatically.
            </p>
          </div>

          {matched.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="text-left border-b text-muted-foreground">
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
                        <Link
                          href={`/dashboard/customers/${p.id}`}
                          className="hover:underline"
                        >
                          {p.firstName} {p.lastName}
                        </Link>
                      </td>
                      <td className="py-2">
                        <span className={`text-xs rounded-full px-2 py-0.5 ${STAGE_STYLES[stageOf(p, rules)]}`}>
                          {JOURNEY_LABELS[stageOf(p, rules)]}
                        </span>
                      </td>
                      <td className="py-2">{formatCents(p.totalSpentCents)}</td>
                      <td className="py-2">{p.orderCount}</td>
                      <td className="py-2">
                        {isReachable(p) ? (
                          <span className="text-emerald-600">Yes</span>
                        ) : (
                          <span className="text-muted-foreground/70">No</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {matched.length > 30 && (
                <p className="text-xs text-muted-foreground/70 mt-2">
                  Showing 30 of {matched.length}. Export for the full list.
                </p>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
