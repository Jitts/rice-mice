"use client";

import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
} from "react";
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
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type Connection,
  type NodeChange,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { GraphEdge, GraphNode, JourneyDefinition } from "@/lib/journeys";

type NodeData = GraphNode["data"];

const handleCls = "!w-2.5 !h-2.5 !bg-muted-foreground !border-background";

function TriggerNode({ data, selected }: NodeProps) {
  const d = data as NodeData;
  return (
    <div
      className={`rounded-lg border bg-destructive/10 border-destructive/30 px-3 py-2 min-w-[130px] ${
        selected ? "ring-2 ring-blue-400" : ""
      }`}
    >
      <div className="text-[9px] tracking-wide text-destructive">TRIGGER</div>
      <div className="text-xs font-medium text-destructive">
        {d.segmentName ? `Audience: ${d.segmentName}` : "Choose an audience"}
      </div>
      <Handle type="source" position={Position.Right} className={handleCls} />
    </div>
  );
}

function WaitNode({ data, selected }: NodeProps) {
  const d = data as NodeData;
  return (
    <div
      className={`rounded-lg border bg-muted border-input px-3 py-2 min-w-[110px] ${
        selected ? "ring-2 ring-blue-400" : ""
      }`}
    >
      <div className="text-xs font-medium text-foreground/80">
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
      className={`rounded-lg border bg-violet-50 dark:bg-violet-950/40 border-violet-200 dark:border-violet-800 px-3 py-2 min-w-[150px] max-w-[190px] ${
        selected ? "ring-2 ring-blue-400" : ""
      }`}
    >
      <div className="text-[9px] tracking-wide text-violet-700 dark:text-violet-300">
        {d.channel === "email" ? "EMAIL" : "WHATSAPP"} DRAFT
        {d.offerCode ? ` · ${d.offerCode}` : ""}
      </div>
      <div className="text-xs font-medium text-violet-900 dark:text-violet-200 truncate">
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

function fromFlow(nodes: Node[], edges: Edge[]): { nodes: GraphNode[]; edges: GraphEdge[] } {
  return {
    nodes: nodes.map((n) => ({
      id: n.id,
      type: (n.type ?? "wait") as GraphNode["type"],
      x: Math.round(n.position.x),
      y: Math.round(n.position.y),
      data: n.data as NodeData,
    })),
    edges: edges.map((e) => ({
      id: e.id,
      from: e.source,
      to: e.target,
      handle: (e.sourceHandle ?? undefined) as "yes" | "no" | undefined,
    })),
  };
}

export type JourneyCanvasHandle = {
  patchNode: (id: string, data: Partial<NodeData>) => void;
};

type CanvasProps = {
  definition: JourneyDefinition; // seeds local state once, at mount only
  onChange: (part: { nodes: GraphNode[]; edges: GraphEdge[] }) => void;
  onSelect: (nodeId: string | null) => void;
};

// Nodes/edges live in LOCAL state (React Flow's documented pattern), not
// re-derived from the parent's `definition` on every render. Routing every
// drag frame through a separate component's state and back down as a new
// controlled prop is what caused nodes to fight their way back to their old
// position instead of following the pointer — the parent only hears about
// changes after the fact, via the sync-out effect below.
const CanvasInner = forwardRef<JourneyCanvasHandle, CanvasProps>(function CanvasInner(
  { definition, onChange, onSelect },
  ref,
) {
  const { screenToFlowPosition } = useReactFlow();
  const addSeq = useRef(0);

  // Seeded once at mount. Switching journeys remounts this component via a
  // `key` on the wrapper (see JourneysManager), so this never re-seeds mid-edit.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const initial = useMemo(() => toFlow(definition), []);
  const [nodes, setNodes, onNodesChangeBase] = useNodesState<Node>(initial.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(initial.edges);

  // Push the graph up to the parent for save/validate/launch, synchronously
  // before paint so the properties panel never lags a keystroke behind.
  useLayoutEffect(() => {
    onChange(fromFlow(nodes, edges));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, edges]);

  useImperativeHandle(
    ref,
    () => ({
      patchNode(id, data) {
        setNodes((nds) =>
          nds.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...data } } : n)),
        );
      },
    }),
    [setNodes],
  );

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      const safe = changes.filter((c) => !(c.type === "remove" && c.id === "trigger"));
      onNodesChangeBase(safe);
    },
    [onNodesChangeBase],
  );

  // Connection rules enforced while drawing: one arrow out of ordinary nodes,
  // one per Yes/No side of a branch, no self-loops.
  const onConnect = useCallback(
    (c: Connection) => {
      if (!c.source || !c.target || c.source === c.target) return;
      setEdges((eds) => {
        const already = eds.some(
          (e) => e.source === c.source && (e.sourceHandle ?? null) === (c.sourceHandle ?? null),
        );
        if (already) return eds;
        return [
          ...eds,
          {
            id: `e-${c.source}-${c.sourceHandle ?? "out"}-${c.target}-${Date.now()}`,
            source: c.source,
            target: c.target,
            sourceHandle: c.sourceHandle ?? undefined,
          },
        ];
      });
    },
    [setEdges],
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
              : {}; // trigger — never added via the palette, but keep this exhaustive

      const fallback = {
        x: 200 + (addSeq.current % 4) * 40,
        y: 60 + (addSeq.current % 5) * 44,
      };
      let position = at ?? fallback;

      // Click-to-add auto-wires from the currently selected node when it has a
      // free outgoing slot — build a chain without ever dragging a connection.
      const selected = nodes.find((n) => n.selected);
      let newEdge: Edge | null = null;
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
          newEdge = {
            id: `e-${selected.id}-${handle ?? "out"}-${id}`,
            source: selected.id,
            target: id,
            sourceHandle: handle,
          };
          if (!at) {
            position = {
              x: selected.position.x + 190,
              y: selected.position.y + (handle === "no" ? 70 : 0),
            };
          }
        }
      }

      const node: Node = {
        id,
        type,
        position,
        data: data as Record<string, unknown>,
        selected: true,
      };
      setNodes((nds) => [...nds.map((n) => ({ ...n, selected: false })), node]);
      if (newEdge) {
        const edgeToAdd = newEdge;
        setEdges((eds) => [...eds, edgeToAdd]);
      }
      onSelect(id);
    },
    [nodes, edges, setNodes, setEdges, onSelect],
  );

  return (
    <div className="grid grid-cols-[104px_minmax(0,1fr)] gap-3">
      <div className="space-y-1.5">
        <div className="text-[10px] text-muted-foreground/70 mb-1">ADD A BLOCK</div>
        {(
          [
            ["wait", "Wait", "bg-muted border-input text-foreground/80"],
            ["message", "Message", "bg-violet-50 dark:bg-violet-950/40 border-violet-200 dark:border-violet-800 text-violet-800 dark:text-violet-200"],
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
        <p className="text-[10px] text-muted-foreground/70 leading-snug pt-1">
          Click to add after the selected node, or drag anywhere. Drag between
          node dots to connect; select + Delete removes.
        </p>
      </div>

      <div
        className="h-[430px] rounded-xl border border-border bg-card overflow-hidden"
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
});

export const JourneyCanvas = forwardRef<JourneyCanvasHandle, CanvasProps>(function JourneyCanvas(
  props,
  ref,
) {
  return (
    <ReactFlowProvider>
      <CanvasInner ref={ref} {...props} />
    </ReactFlowProvider>
  );
});
