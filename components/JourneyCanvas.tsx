"use client";

import { useCallback, useMemo, useRef } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  Position,
  MarkerType,
  useReactFlow,
  applyNodeChanges,
  applyEdgeChanges,
  type Node,
  type Edge,
  type NodeChange,
  type EdgeChange,
  type Connection,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { GraphNode, JourneyDefinition, JourneyEntry } from "@/lib/journeys";
import { JOURNEY_LABELS } from "@/lib/segments";

type NodeData = GraphNode["data"];

export function entryLabel(entry: JourneyEntry | undefined | null): string {
  if (!entry) return "Choose who enters";
  switch (entry.type) {
    case "stage":
      return `Enters ${JOURNEY_LABELS[entry.stage]}`;
    case "no_visit":
      return `No visit in ${entry.days}+ days`;
    case "signed_up":
      return `Signed up ≤ ${entry.days} days ago`;
    case "birthday_month":
      return "Birthday this month";
    case "tag":
      return entry.tag ? `Has tag “${entry.tag}”` : "Has tag …";
  }
}

const handleCls = "!w-2.5 !h-2.5 !bg-neutral-400 !border-white";

function TriggerNode({ data, selected }: NodeProps) {
  const d = data as NodeData;
  return (
    <div
      className={`rounded-lg border bg-red-50 border-red-200 px-3 py-2 min-w-[130px] ${
        selected ? "ring-2 ring-blue-400" : ""
      }`}
    >
      <div className="text-[9px] tracking-wide text-red-700">TRIGGER</div>
      <div className="text-xs font-medium text-red-900">{entryLabel(d.entry)}</div>
      <Handle type="source" position={Position.Right} className={handleCls} />
    </div>
  );
}

function WaitNode({ data, selected }: NodeProps) {
  const d = data as NodeData;
  return (
    <div
      className={`rounded-lg border bg-neutral-50 border-neutral-300 px-3 py-2 min-w-[110px] ${
        selected ? "ring-2 ring-blue-400" : ""
      }`}
    >
      <div className="text-xs font-medium text-neutral-700">
        Wait {d.days ?? 0} day{(d.days ?? 0) === 1 ? "" : "s"}
      </div>
      <Handle type="target" position={Position.Left} className={handleCls} />
      <Handle type="source" position={Position.Right} className={handleCls} />
    </div>
  );
}

function MessageNode({ data, selected }: NodeProps) {
  const d = data as NodeData;
  const preview = (d.body ?? "").replace(/\s+/g, " ").slice(0, 34);
  return (
    <div
      className={`rounded-lg border bg-violet-50 border-violet-200 px-3 py-2 min-w-[150px] max-w-[190px] ${
        selected ? "ring-2 ring-blue-400" : ""
      }`}
    >
      <div className="text-[9px] tracking-wide text-violet-700">
        {d.channel === "email" ? "EMAIL" : "WHATSAPP"} DRAFT
        {d.offerCode ? ` · ${d.offerCode}` : ""}
      </div>
      <div className="text-xs font-medium text-violet-900 truncate">
        {preview || "Empty message…"}
      </div>
      <Handle type="target" position={Position.Left} className={handleCls} />
      <Handle type="source" position={Position.Right} className={handleCls} />
    </div>
  );
}

function BranchNode({ data, selected }: NodeProps) {
  const d = data as NodeData;
  return (
    <div
      className={`rounded-lg border bg-teal-50 border-teal-200 px-3 py-2 pr-8 min-w-[150px] ${
        selected ? "ring-2 ring-blue-400" : ""
      }`}
    >
      <div className="text-[9px] tracking-wide text-teal-700">BRANCH</div>
      <div className="text-xs font-medium text-teal-900">
        {d.condition === "visited_since_entry"
          ? "Visited since entering?"
          : "Still away since entering?"}
      </div>
      <span className="absolute right-1 top-[22%] text-[8px] text-teal-700">Y</span>
      <span className="absolute right-1 top-[62%] text-[8px] text-teal-700">N</span>
      <Handle type="target" position={Position.Left} className={handleCls} />
      <Handle
        id="yes"
        type="source"
        position={Position.Right}
        style={{ top: "30%" }}
        className={handleCls}
      />
      <Handle
        id="no"
        type="source"
        position={Position.Right}
        style={{ top: "70%" }}
        className={handleCls}
      />
    </div>
  );
}

const nodeTypes = {
  trigger: TriggerNode,
  wait: WaitNode,
  message: MessageNode,
  branch: BranchNode,
};

function toFlow(def: JourneyDefinition): { nodes: Node[]; edges: Edge[] } {
  return {
    nodes: def.nodes.map((n) => ({
      id: n.id,
      type: n.type,
      position: { x: n.x, y: n.y },
      data: n.data as Record<string, unknown>,
      deletable: n.type !== "trigger",
    })),
    edges: def.edges.map((e) => ({
      id: e.id,
      source: e.from,
      target: e.to,
      sourceHandle: e.handle,
      label: e.handle === "yes" ? "Yes" : e.handle === "no" ? "No" : undefined,
      labelStyle: { fontSize: 10 },
      markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
      style: { strokeWidth: 1.5 },
    })),
  };
}

function CanvasInner({
  definition,
  onChange,
  onSelect,
}: {
  definition: JourneyDefinition;
  onChange: (def: JourneyDefinition) => void;
  onSelect: (nodeId: string | null) => void;
}) {
  const { screenToFlowPosition } = useReactFlow();
  const wrapper = useRef<HTMLDivElement>(null);
  const addSeq = useRef(0);

  const { nodes, edges } = useMemo(() => toFlow(definition), [definition]);

  const commit = useCallback(
    (nextNodes: Node[], nextEdges: Edge[]) => {
      onChange({
        exitOnOrder: definition.exitOnOrder,
        nodes: nextNodes.map((n) => ({
          id: n.id,
          type: (n.type ?? "wait") as GraphNode["type"],
          x: Math.round(n.position.x),
          y: Math.round(n.position.y),
          data: n.data as NodeData,
        })),
        edges: nextEdges.map((e) => ({
          id: e.id,
          from: e.source,
          to: e.target,
          handle: (e.sourceHandle ?? undefined) as "yes" | "no" | undefined,
        })),
      });
    },
    [definition.exitOnOrder, onChange],
  );

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      const safe = changes.filter(
        (c) => !(c.type === "remove" && c.id === "trigger"),
      );
      commit(applyNodeChanges(safe, nodes), edges);
    },
    [nodes, edges, commit],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      commit(nodes, applyEdgeChanges(changes, edges));
    },
    [nodes, edges, commit],
  );

  // Connection rules enforced while drawing: one arrow out of ordinary nodes,
  // one per Yes/No side of a branch, no self-loops.
  const onConnect = useCallback(
    (c: Connection) => {
      if (!c.source || !c.target || c.source === c.target) return;
      const already = edges.some(
        (e) => e.source === c.source && (e.sourceHandle ?? null) === (c.sourceHandle ?? null),
      );
      if (already) return;
      const edge: Edge = {
        id: `e-${c.source}-${c.sourceHandle ?? "out"}-${c.target}-${Date.now()}`,
        source: c.source,
        target: c.target,
        sourceHandle: c.sourceHandle ?? undefined,
      };
      commit(nodes, [...edges, edge]);
    },
    [nodes, edges, commit],
  );

  const addNode = useCallback(
    (type: GraphNode["type"], at?: { x: number; y: number }) => {
      addSeq.current += 1;
      const id = `${type}-${Date.now()}-${addSeq.current}`;
      const data: NodeData =
        type === "wait"
          ? { days: 2 }
          : type === "message"
            ? { channel: "whatsapp", body: "Hi {{name}}! " }
            : type === "branch"
              ? { condition: "not_visited_since_entry" }
              : { entry: { type: "stage", stage: "at_risk" } };
      const fallback = {
        x: 200 + (addSeq.current % 4) * 40,
        y: 60 + (addSeq.current % 5) * 44,
      };
      const node: Node = {
        id,
        type,
        position: at ?? fallback,
        data: data as Record<string, unknown>,
      };

      // Click-to-add auto-wires from the currently selected node when it has a
      // free outgoing slot — build a chain without ever dragging a connection.
      let nextEdges = edges;
      const selected = nodes.find((n) => n.selected);
      if (selected && selected.id !== id) {
        const outs = edges.filter((e) => e.source === selected.id);
        let handle: "yes" | "no" | undefined;
        let free = false;
        if (selected.type === "branch") {
          if (!outs.some((e) => e.sourceHandle === "yes")) {
            handle = "yes";
            free = true;
          } else if (!outs.some((e) => e.sourceHandle === "no")) {
            handle = "no";
            free = true;
          }
        } else {
          free = outs.length === 0;
        }
        if (free) {
          nextEdges = [
            ...edges,
            {
              id: `e-${selected.id}-${handle ?? "out"}-${id}`,
              source: selected.id,
              target: id,
              sourceHandle: handle,
            },
          ];
          if (!at) {
            node.position = {
              x: selected.position.x + 190,
              y: selected.position.y + (handle === "no" ? 70 : 0),
            };
          }
        }
      }
      commit(
        [...nodes.map((n) => ({ ...n, selected: false })), { ...node, selected: true }],
        nextEdges,
      );
      onSelect(id);
    },
    [nodes, edges, commit, onSelect],
  );

  return (
    <div className="grid grid-cols-[104px_minmax(0,1fr)] gap-3">
      <div className="space-y-1.5">
        <div className="text-[10px] text-neutral-400 mb-1">ADD A BLOCK</div>
        {(
          [
            ["wait", "Wait", "bg-neutral-50 border-neutral-300 text-neutral-700"],
            ["message", "Message", "bg-violet-50 border-violet-200 text-violet-800"],
            ["branch", "Branch", "bg-teal-50 border-teal-200 text-teal-800"],
          ] as const
        ).map(([type, label, cls]) => (
          <button
            key={type}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData("application/rice-mice-node", type);
              e.dataTransfer.effectAllowed = "move";
            }}
            onClick={() => addNode(type)}
            className={`w-full text-left text-xs border rounded-lg px-2.5 py-2 cursor-grab active:cursor-grabbing ${cls}`}
          >
            + {label}
          </button>
        ))}
        <p className="text-[10px] text-neutral-400 leading-snug pt-1">
          Click to add after the selected node, or drag anywhere. Drag between
          node dots to connect; select + Delete removes.
        </p>
      </div>

      <div
        ref={wrapper}
        className="h-[430px] rounded-xl border border-neutral-200 bg-white overflow-hidden"
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
        }}
        onDrop={(e) => {
          e.preventDefault();
          const type = e.dataTransfer.getData("application/rice-mice-node");
          if (!type) return;
          addNode(
            type as GraphNode["type"],
            screenToFlowPosition({ x: e.clientX, y: e.clientY }),
          );
        }}
      >
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onSelectionChange={({ nodes: sel }) => onSelect(sel[0]?.id ?? null)}
          fitView
          fitViewOptions={{ padding: 0.25, maxZoom: 1 }}
          proOptions={{ hideAttribution: false }}
          deleteKeyCode={["Backspace", "Delete"]}
        >
          <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
    </div>
  );
}

export function JourneyCanvas(props: {
  definition: JourneyDefinition;
  onChange: (def: JourneyDefinition) => void;
  onSelect: (nodeId: string | null) => void;
}) {
  return (
    <ReactFlowProvider>
      <CanvasInner {...props} />
    </ReactFlowProvider>
  );
}
