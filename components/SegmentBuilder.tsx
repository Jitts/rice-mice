"use client";

import {
  newCondition,
  newGroup,
  newSegmentRef,
  type Combinator,
  type Condition,
  type FieldDef,
  type Group,
  type OptionLists,
  type SegmentDefinition,
  type SegmentNode,
  type SegmentRef,
  type SegmentRefMode,
} from "@/lib/segments";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export type SegmentOption = { id: string; name: string };

type DragPayload =
  | { kind: "palette"; field: string }
  | { kind: "palette_ref" }
  | { kind: "move"; path: number[]; index: number };

const DND_MIME = "application/rice-mice-segment";

function writePayload(e: React.DragEvent, payload: DragPayload) {
  e.dataTransfer.setData(DND_MIME, JSON.stringify(payload));
  e.dataTransfer.effectAllowed = "copyMove";
}
function readPayload(e: React.DragEvent): DragPayload | null {
  try {
    const raw = e.dataTransfer.getData(DND_MIME);
    return raw ? (JSON.parse(raw) as DragPayload) : null;
  } catch {
    return null;
  }
}

// A palette chip is dragged from the criteria rail into any group. Exported so
// the manager can render the rail with matching drag behaviour.
export function paletteDragProps(fieldId: string) {
  return {
    draggable: true,
    onDragStart: (e: React.DragEvent) => writePayload(e, { kind: "palette", field: fieldId }),
  };
}
export function segmentRefDragProps() {
  return {
    draggable: true,
    onDragStart: (e: React.DragEvent) => writePayload(e, { kind: "palette_ref" }),
  };
}

// --- immutable tree helpers (address a group by its child-index path) ---------
function clone(def: SegmentDefinition): SegmentDefinition {
  return structuredClone(def);
}
function groupAt(root: Group, path: number[]): Group {
  let g: Group = root;
  for (const idx of path) {
    const child = g.children[idx];
    if (!child || child.type !== "group") return g;
    g = child;
  }
  return g;
}
const samePath = (a: number[], b: number[]) =>
  a.length === b.length && a.every((v, i) => v === b[i]);

export function SegmentBuilder({
  definition,
  onChange,
  options,
  fields,
  fieldsById,
  segmentOptions,
}: {
  definition: SegmentDefinition;
  onChange: (def: SegmentDefinition) => void;
  options: OptionLists;
  fields: FieldDef[];
  fieldsById: Record<string, FieldDef>;
  segmentOptions: SegmentOption[];
}) {
  const setCombinator = (path: number[], comb: Combinator) => {
    const d = clone(definition);
    groupAt(d, path).combinator = comb;
    onChange(d);
  };
  const addCondition = (path: number[], field: string) => {
    const d = clone(definition);
    groupAt(d, path).children.push(newCondition(field, fieldsById));
    onChange(d);
  };
  const addSegmentRef = (path: number[]) => {
    if (segmentOptions.length === 0) return;
    const d = clone(definition);
    groupAt(d, path).children.push(newSegmentRef(segmentOptions[0].id, "include"));
    onChange(d);
  };
  const addGroup = (path: number[]) => {
    const d = clone(definition);
    groupAt(d, path).children.push(newGroup("any"));
    onChange(d);
  };
  const removeChild = (path: number[], index: number) => {
    const d = clone(definition);
    groupAt(d, path).children.splice(index, 1);
    onChange(d);
  };
  const patchCondition = (path: number[], index: number, patch: Partial<Condition>) => {
    const d = clone(definition);
    const g = groupAt(d, path);
    g.children[index] = { ...(g.children[index] as Condition), ...patch };
    onChange(d);
  };
  const patchSegmentRef = (path: number[], index: number, patch: Partial<SegmentRef>) => {
    const d = clone(definition);
    const g = groupAt(d, path);
    g.children[index] = { ...(g.children[index] as SegmentRef), ...patch };
    onChange(d);
  };
  const reorder = (path: number[], from: number, to: number) => {
    if (from === to) return;
    const d = clone(definition);
    const arr = groupAt(d, path).children;
    const [moved] = arr.splice(from, 1);
    arr.splice(to, 0, moved);
    onChange(d);
  };

  const onGroupDrop = (path: number[]) => (e: React.DragEvent) => {
    e.preventDefault();
    const p = readPayload(e);
    if (p?.kind === "palette") addCondition(path, p.field);
    else if (p?.kind === "palette_ref") addSegmentRef(path);
  };
  const onRowDrop = (path: number[], index: number) => (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const p = readPayload(e);
    if (!p) return;
    if (p.kind === "palette") addCondition(path, p.field);
    else if (p.kind === "palette_ref") addSegmentRef(path);
    else if (p.kind === "move" && samePath(p.path, path)) reorder(path, p.index, index);
  };

  const renderNode = (node: SegmentNode, path: number[], index: number) => (
    <div key={index} onDrop={onRowDrop(path, index)} onDragOver={(e) => e.preventDefault()}>
      {node.type === "condition" ? (
        <ConditionRow
          condition={node}
          onDragStart={(e) => writePayload(e, { kind: "move", path, index })}
          options={options}
          fields={fields}
          fieldsById={fieldsById}
          onPatch={(patch) => patchCondition(path, index, patch)}
          onRemove={() => removeChild(path, index)}
        />
      ) : node.type === "segment_ref" ? (
        <SegmentRefRow
          node={node}
          onDragStart={(e) => writePayload(e, { kind: "move", path, index })}
          segmentOptions={segmentOptions}
          onPatch={(patch) => patchSegmentRef(path, index, patch)}
          onRemove={() => removeChild(path, index)}
        />
      ) : (
        <GroupView
          group={node}
          path={[...path, index]}
          onRemove={() => removeChild(path, index)}
        />
      )}
    </div>
  );

  function GroupView({
    group,
    path,
    onRemove,
  }: {
    group: Group;
    path: number[];
    onRemove?: () => void;
  }) {
    const isRoot = path.length === 0;
    return (
      <div
        onDrop={onGroupDrop(path)}
        onDragOver={(e) => e.preventDefault()}
        className={`rounded-lg border bg-white p-3 space-y-2 ${
          isRoot
            ? "border-neutral-300"
            : "border-l-4 border-l-neutral-400 border-neutral-200"
        }`}
      >
        <div className="flex items-center gap-2 text-sm">
          <span className="text-neutral-500">Match</span>
          <div className="inline-flex rounded border border-neutral-300 overflow-hidden">
            {(["all", "any"] as Combinator[]).map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setCombinator(path, c)}
                className={`px-2 py-0.5 ${
                  group.combinator === c
                    ? "bg-neutral-900 text-white"
                    : "bg-white text-neutral-600"
                }`}
              >
                {c.toUpperCase()}
              </button>
            ))}
          </div>
          <span className="text-neutral-500">of these</span>
          {!isRoot && onRemove && (
            <button
              type="button"
              onClick={onRemove}
              className="ml-auto text-neutral-400 hover:text-red-600"
              aria-label="Remove group"
            >
              ×
            </button>
          )}
        </div>

        {group.children.length === 0 ? (
          <p className="text-xs text-neutral-400 py-2">
            Drag a criterion here, or use the buttons below.
          </p>
        ) : (
          <div className="space-y-2">
            {group.children.map((child, i) => renderNode(child, path, i))}
          </div>
        )}

        <div className="flex flex-wrap gap-3 text-xs pt-1">
          <AddConditionMenu fields={fields} onAdd={(field) => addCondition(path, field)} />
          <button
            type="button"
            onClick={() => addGroup(path)}
            className="text-neutral-500 hover:text-neutral-900"
          >
            + Nested group
          </button>
          <button
            type="button"
            onClick={() => addSegmentRef(path)}
            disabled={segmentOptions.length === 0}
            title={
              segmentOptions.length === 0
                ? "Save another segment first"
                : "Include or exclude another saved segment"
            }
            className="text-neutral-500 hover:text-neutral-900 disabled:text-neutral-300 disabled:hover:text-neutral-300"
          >
            + Saved segment
          </button>
        </div>
      </div>
    );
  }

  return <GroupView group={definition} path={[]} />;
}

function AddConditionMenu({
  fields,
  onAdd,
}: {
  fields: FieldDef[];
  onAdd: (field: string) => void;
}) {
  return (
    <label className="text-neutral-500 hover:text-neutral-900 cursor-pointer">
      + Condition
      <select
        className="ml-1 border border-neutral-300 rounded bg-white text-neutral-700"
        value=""
        onChange={(e) => {
          if (e.target.value) onAdd(e.target.value);
          e.target.value = "";
        }}
      >
        <option value="">choose…</option>
        {fields.map((f) => (
          <option key={f.id} value={f.id}>
            {f.label}
            {f.custom ? " (custom)" : ""}
          </option>
        ))}
      </select>
    </label>
  );
}

function SegmentRefRow({
  node,
  segmentOptions,
  onPatch,
  onRemove,
  onDragStart,
}: {
  node: SegmentRef;
  segmentOptions: SegmentOption[];
  onPatch: (patch: Partial<SegmentRef>) => void;
  onRemove: () => void;
  onDragStart: (e: React.DragEvent) => void;
}) {
  return (
    <div
      draggable
      onDragStart={onDragStart}
      className="flex flex-wrap items-center gap-2 bg-violet-50 border border-violet-200 rounded px-2 py-1.5 text-sm"
    >
      <span className="cursor-grab text-violet-300 select-none" aria-hidden>
        ⠿
      </span>
      <span className="text-violet-700">Customer</span>
      <div className="inline-flex rounded border border-violet-300 overflow-hidden">
        {(["include", "exclude"] as SegmentRefMode[]).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => onPatch({ mode: m })}
            className={`px-2 py-0.5 ${
              node.mode === m ? "bg-violet-700 text-white" : "bg-white text-violet-700"
            }`}
          >
            {m === "include" ? "is in" : "is not in"}
          </button>
        ))}
      </div>
      {segmentOptions.length === 0 ? (
        <span className="text-violet-400 text-xs">no other saved segments</span>
      ) : (
        <select
          value={segmentOptions.some((s) => s.id === node.segmentId) ? node.segmentId : ""}
          onChange={(e) => onPatch({ segmentId: e.target.value })}
          className="border border-violet-300 rounded bg-white px-1 py-0.5 text-violet-700 max-w-[10rem]"
        >
          <option value="">choose…</option>
          {segmentOptions.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      )}
      <button
        type="button"
        onClick={onRemove}
        className="ml-auto text-violet-400 hover:text-red-600"
        aria-label="Remove saved-segment reference"
      >
        ×
      </button>
    </div>
  );
}

function ConditionRow({
  condition,
  options,
  fields,
  fieldsById,
  onPatch,
  onRemove,
  onDragStart,
}: {
  condition: Condition;
  options: OptionLists;
  fields: FieldDef[];
  fieldsById: Record<string, FieldDef>;
  onPatch: (patch: Partial<Condition>) => void;
  onRemove: () => void;
  onDragStart: (e: React.DragEvent) => void;
}) {
  const field = fieldsById[condition.field];
  if (!field) return null;

  return (
    <div
      draggable
      onDragStart={onDragStart}
      className="flex flex-wrap items-center gap-2 bg-neutral-50 border border-neutral-200 rounded px-2 py-1.5 text-sm"
    >
      <span className="cursor-grab text-neutral-400 select-none" aria-hidden>
        ⠿
      </span>

      <select
        value={condition.field}
        onChange={(e) => onPatch(newCondition(e.target.value, fieldsById))}
        className="border border-neutral-300 rounded bg-white px-1 py-0.5"
      >
        {fields.map((f) => (
          <option key={f.id} value={f.id}>
            {f.label}
            {f.custom ? " (custom)" : ""}
          </option>
        ))}
      </select>

      <select
        value={condition.op}
        onChange={(e) => onPatch({ op: e.target.value })}
        className="border border-neutral-300 rounded bg-white px-1 py-0.5 text-neutral-600"
      >
        {field.operators.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>

      <ValueControl condition={condition} field={field} options={options} onPatch={onPatch} />

      <button
        type="button"
        onClick={onRemove}
        className="ml-auto text-neutral-400 hover:text-red-600"
        aria-label="Remove condition"
      >
        ×
      </button>
    </div>
  );
}

function ValueControl({
  condition,
  field,
  options,
  onPatch,
}: {
  condition: Condition;
  field: FieldDef;
  options: OptionLists;
  onPatch: (patch: Partial<Condition>) => void;
}) {
  const type = field.type;

  if (type === "money") {
    const rands = typeof condition.value === "number" ? condition.value / 100 : 0;
    return (
      <div className="flex items-center gap-1">
        <span className="text-neutral-500">R</span>
        <input
          type="number"
          min={0}
          step={1}
          value={rands}
          onChange={(e) =>
            onPatch({ value: Math.round((parseFloat(e.target.value) || 0) * 100) })
          }
          className="w-20 border border-neutral-300 rounded px-1 py-0.5"
        />
      </div>
    );
  }

  if (type === "count" || type === "recency" || type === "signup") {
    const suffix = type === "count" ? "orders" : "days";
    return (
      <div className="flex items-center gap-1">
        <input
          type="number"
          min={0}
          step={1}
          value={typeof condition.value === "number" ? condition.value : 0}
          onChange={(e) => onPatch({ value: parseInt(e.target.value) || 0 })}
          className="w-16 border border-neutral-300 rounded px-1 py-0.5"
        />
        <span className="text-neutral-500">{suffix}</span>
      </div>
    );
  }

  if (type === "birthday") {
    const m = typeof condition.value === "number" ? condition.value : 1;
    return (
      <select
        value={m}
        onChange={(e) => onPatch({ value: parseInt(e.target.value) })}
        className="border border-neutral-300 rounded bg-white px-1 py-0.5"
      >
        {MONTHS.map((name, i) => (
          <option key={name} value={i + 1}>
            {name}
          </option>
        ))}
      </select>
    );
  }

  if (type === "custom_number") {
    return (
      <input
        type="number"
        step="any"
        value={typeof condition.value === "number" ? condition.value : 0}
        onChange={(e) => onPatch({ value: parseFloat(e.target.value) || 0 })}
        className="w-20 border border-neutral-300 rounded px-1 py-0.5"
      />
    );
  }

  if (type === "custom_boolean") {
    return (
      <select
        value={condition.value === "false" ? "false" : "true"}
        onChange={(e) => onPatch({ value: e.target.value })}
        className="border border-neutral-300 rounded bg-white px-1 py-0.5"
      >
        <option value="true">Yes</option>
        <option value="false">No</option>
      </select>
    );
  }

  if (type === "custom_date") {
    return (
      <input
        type="date"
        value={condition.value == null ? "" : String(condition.value)}
        onChange={(e) => onPatch({ value: e.target.value })}
        className="border border-neutral-300 rounded px-1 py-0.5"
      />
    );
  }

  if (type === "custom_text") {
    return (
      <input
        type="text"
        value={condition.value == null ? "" : String(condition.value)}
        onChange={(e) => onPatch({ value: e.target.value })}
        placeholder="value"
        className="w-32 border border-neutral-300 rounded px-1 py-0.5"
      />
    );
  }

  const list =
    type === "enum"
      ? options.paymentMethods.length
        ? options.paymentMethods
        : ["card", "cash"]
      : type === "item"
        ? options.items
        : options.tags;

  if (list.length === 0) {
    return (
      <input
        type="text"
        value={condition.value == null ? "" : String(condition.value)}
        onChange={(e) => onPatch({ value: e.target.value })}
        placeholder="value"
        className="w-32 border border-neutral-300 rounded px-1 py-0.5"
      />
    );
  }

  return (
    <select
      value={condition.value == null ? "" : String(condition.value)}
      onChange={(e) => onPatch({ value: e.target.value })}
      className="border border-neutral-300 rounded bg-white px-1 py-0.5 max-w-[10rem]"
    >
      <option value="">choose…</option>
      {list.map((opt) => (
        <option key={opt} value={opt}>
          {opt}
        </option>
      ))}
    </select>
  );
}
