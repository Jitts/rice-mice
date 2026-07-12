import { composeMessage, CHANNELS, type CampaignChannel } from "@/lib/campaigns";
import { stageOf, type CustomerProfile, type JourneyStage } from "@/lib/segments";

// Staff-designed journeys, drawn on a free-form canvas. A human LAUNCHES a
// journey (for N days or evergreen); while it runs, the tick enrolls
// qualifying customers and walks them through the node graph. The only action
// is preparing a message draft into the action inbox — sending remains a human
// click, always.

// --- Graph definition ---------------------------------------------------------

export type JourneyEntry =
  | { type: "stage"; stage: JourneyStage }
  | { type: "no_visit"; days: number }
  | { type: "signed_up"; days: number }
  | { type: "birthday_month" }
  | { type: "tag"; tag: string };

export type BranchCondition = "visited_since_entry" | "not_visited_since_entry";

export type GraphNode = {
  id: string;
  type: "trigger" | "wait" | "message" | "branch";
  x: number;
  y: number;
  data: {
    entry?: JourneyEntry; // trigger
    days?: number; // wait
    channel?: CampaignChannel; // message
    body?: string; // message
    offerCampaignId?: string | null; // message — enables {{code}}
    offerCode?: string | null;
    condition?: BranchCondition; // branch
  };
};

export type GraphEdge = {
  id: string;
  from: string;
  to: string;
  handle?: "yes" | "no"; // set on branch outputs
};

export type JourneyDefinition = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  exitOnOrder: boolean;
};

export const EMPTY_JOURNEY: JourneyDefinition = {
  nodes: [
    {
      id: "trigger",
      type: "trigger",
      x: 40,
      y: 80,
      data: { entry: { type: "stage", stage: "at_risk" } },
    },
  ],
  edges: [],
  exitOnOrder: true,
};

export type Journey = {
  id: string;
  created_at: string;
  updated_at: string;
  name: string;
  definition: JourneyDefinition;
  status: "draft" | "running" | "stopped";
  launched_at: string | null;
  run_until: string | null; // null while running = evergreen
  created_by: string | null;
};

// Where a run stands: the id of the NEXT node to process. Anything else
// (legacy [], null) means "not started".
export type RunPosition = { node: string } | null;

export type JourneyRun = {
  id: string;
  journey_id: string;
  customer_id: string;
  entered_at: string;
  position: unknown;
  due_at: string | null;
  status: "active" | "completed" | "exited";
};

export type MessagePayload = {
  channel: CampaignChannel;
  body: string; // fully rendered, incl. unsubscribe footer
  address: string;
  journey_name: string;
};

// --- Helpers -------------------------------------------------------------------

const DAY_MS = 86400000;

export function getEntry(def: JourneyDefinition): JourneyEntry | null {
  const t = def.nodes.find((n) => n.type === "trigger");
  return t?.data.entry ?? null;
}

function nodeById(def: JourneyDefinition, id: string): GraphNode | null {
  return def.nodes.find((n) => n.id === id) ?? null;
}

function edgeFrom(def: JourneyDefinition, id: string, handle?: "yes" | "no"): GraphEdge | null {
  return (
    def.edges.find((e) => e.from === id && (handle ? e.handle === handle : true)) ?? null
  );
}

export function entryMatches(
  entry: JourneyEntry,
  p: CustomerProfile,
  now: Date,
): boolean {
  switch (entry.type) {
    case "stage":
      return stageOf(p) === entry.stage;
    case "no_visit": {
      if (!p.lastVisit) return false;
      return now.getTime() - new Date(p.lastVisit).getTime() > entry.days * DAY_MS;
    }
    case "signed_up":
      return now.getTime() - new Date(p.createdAt).getTime() <= entry.days * DAY_MS;
    case "birthday_month":
      return !!p.birthday && new Date(p.birthday).getUTCMonth() === now.getUTCMonth();
    case "tag":
      return p.tags.includes(entry.tag);
  }
}

// {{days_away}} joins the template vocabulary for journeys.
export function composeJourneyMessage(
  body: string,
  p: CustomerProfile,
  offerCode?: string | null,
  now: Date = new Date(),
): string {
  const days = p.lastVisit
    ? Math.max(1, Math.floor((now.getTime() - new Date(p.lastVisit).getTime()) / DAY_MS))
    : null;
  const withDays = body.replaceAll("{{days_away}}", days === null ? "a while" : String(days));
  return composeMessage(withDays, p, offerCode);
}

// --- Validation (gates the Launch button) ----------------------------------------

export function validateGraph(def: JourneyDefinition): string[] {
  const problems: string[] = [];
  const triggers = def.nodes.filter((n) => n.type === "trigger");
  if (triggers.length !== 1) {
    problems.push(
      triggers.length === 0 ? "Add a trigger node." : "Only one trigger is allowed.",
    );
  }
  // A trigger-only journey would consume every qualifying customer's
  // once-per-journey entry while doing nothing.
  if (def.nodes.length === triggers.length) {
    problems.push("Add at least one step after the trigger.");
  }

  const ids = new Set(def.nodes.map((n) => n.id));
  for (const e of def.edges) {
    if (!ids.has(e.from) || !ids.has(e.to)) problems.push("An arrow points at nothing.");
  }

  for (const n of def.nodes) {
    const out = def.edges.filter((e) => e.from === n.id);
    if (n.type === "branch") {
      if (!out.some((e) => e.handle === "yes") || !out.some((e) => e.handle === "no"))
        problems.push("A branch needs both a Yes and a No arrow.");
      if (out.length > 2) problems.push("A branch can only have Yes and No arrows.");
    } else if (out.length > 1) {
      problems.push(`A ${n.type} node can only lead to one next step.`);
    }
    if (n.type === "trigger" && out.length === 0 && def.nodes.length > 1)
      problems.push("Connect the trigger to a first step.");
    if (n.type === "message" && !(n.data.body ?? "").trim())
      problems.push("A message node has an empty message.");
  }

  // Reachability from the trigger.
  if (triggers.length === 1) {
    const seen = new Set<string>([triggers[0].id]);
    const queue = [triggers[0].id];
    while (queue.length) {
      const cur = queue.shift()!;
      for (const e of def.edges) {
        if (e.from === cur && !seen.has(e.to)) {
          seen.add(e.to);
          queue.push(e.to);
        }
      }
    }
    if (def.nodes.some((n) => !seen.has(n.id)))
      problems.push("Some nodes aren't connected to the flow.");
  }

  // Loops are allowed only through a Wait of ≥1 day: cut those waits out and
  // any cycle that remains would spin without pausing.
  const cutIds = new Set(
    def.nodes.filter((n) => n.type === "wait" && (n.data.days ?? 0) >= 1).map((n) => n.id),
  );
  const color = new Map<string, number>(); // 0 unvisited, 1 in-stack, 2 done
  const hasCycle = (id: string): boolean => {
    color.set(id, 1);
    for (const e of def.edges) {
      if (e.from !== id || cutIds.has(e.to)) continue;
      const c = color.get(e.to) ?? 0;
      if (c === 1) return true;
      if (c === 0 && hasCycle(e.to)) return true;
    }
    color.set(id, 2);
    return false;
  };
  for (const n of def.nodes) {
    if (cutIds.has(n.id) || (color.get(n.id) ?? 0) !== 0) continue;
    if (hasCycle(n.id)) {
      problems.push("A loop must pass through a Wait of at least 1 day.");
      break;
    }
  }

  return [...new Set(problems)];
}

// --- The tick (pure) -----------------------------------------------------------------

export type TickOrder = {
  customer_id: string | null;
  status: string;
  created_at: string;
};

export type TickEnroll = {
  customer_id: string;
  position: RunPosition;
  due_at: string | null;
  status: JourneyRun["status"];
  actions: MessagePayload[];
};

export type TickUpdate = {
  id: string;
  position: RunPosition;
  due_at: string | null;
  status: JourneyRun["status"];
  actions: MessagePayload[];
};

export type TickResult = { enroll: TickEnroll[]; updates: TickUpdate[] };

function orderedSince(orders: TickOrder[], customerId: string, sinceIso: string): boolean {
  const since = new Date(sinceIso).getTime();
  return orders.some(
    (o) =>
      o.customer_id === customerId &&
      o.status === "completed" &&
      new Date(o.created_at).getTime() > since,
  );
}

function asPosition(raw: unknown): RunPosition {
  if (raw && typeof raw === "object" && !Array.isArray(raw) && "node" in raw) {
    return raw as RunPosition;
  }
  return null;
}

function processRun(
  def: JourneyDefinition,
  profile: CustomerProfile,
  journeyName: string,
  enteredAt: string,
  startPosition: RunPosition,
  startDue: string | null,
  orders: TickOrder[],
  now: Date,
): { position: RunPosition; due_at: string | null; status: JourneyRun["status"]; actions: MessagePayload[] } {
  const actions: MessagePayload[] = [];

  if (def.exitOnOrder && orderedSince(orders, profile.id, enteredAt)) {
    return { position: startPosition, due_at: null, status: "exited", actions };
  }
  if (startDue && new Date(startDue).getTime() > now.getTime()) {
    return { position: startPosition, due_at: startDue, status: "active", actions };
  }

  // Resolve the starting node: stored position, or the node after the trigger.
  let nodeId: string | null;
  if (startPosition?.node) {
    nodeId = startPosition.node;
  } else {
    const trigger = def.nodes.find((n) => n.type === "trigger");
    nodeId = trigger ? (edgeFrom(def, trigger.id)?.to ?? null) : null;
  }

  for (let guard = 0; guard < 100; guard++) {
    const node = nodeId ? nodeById(def, nodeId) : null;
    if (!node) return { position: null, due_at: null, status: "completed", actions };

    if (node.type === "wait") {
      const next = edgeFrom(def, node.id)?.to ?? null;
      if (!next) return { position: null, due_at: null, status: "completed", actions };
      return {
        position: { node: next },
        due_at: new Date(now.getTime() + (node.data.days ?? 0) * DAY_MS).toISOString(),
        status: "active",
        actions,
      };
    }

    if (node.type === "message") {
      const channel = CHANNELS.find((c) => c.id === node.data.channel);
      const address = channel ? channel.address(profile) : null;
      if (address) {
        actions.push({
          channel: node.data.channel ?? "whatsapp",
          body: composeJourneyMessage(node.data.body ?? "", profile, node.data.offerCode, now),
          address,
          journey_name: journeyName,
        });
      }
      nodeId = edgeFrom(def, node.id)?.to ?? null;
      continue;
    }

    if (node.type === "branch") {
      const visited = orderedSince(orders, profile.id, enteredAt);
      const takeYes = node.data.condition === "visited_since_entry" ? visited : !visited;
      nodeId = edgeFrom(def, node.id, takeYes ? "yes" : "no")?.to ?? null;
      continue;
    }

    // trigger (shouldn't be re-entered) — follow its edge defensively
    nodeId = edgeFrom(def, node.id)?.to ?? null;
  }
  return { position: null, due_at: null, status: "completed", actions };
}

export function tickJourney(
  journey: Journey,
  runs: JourneyRun[],
  profiles: CustomerProfile[],
  orders: TickOrder[],
  now: Date = new Date(),
): TickResult {
  const result: TickResult = { enroll: [], updates: [] };
  if (journey.status !== "running") return result;
  const def = journey.definition;
  if (!def || !Array.isArray(def.nodes)) return result; // legacy/blank definitions are inert
  const entry = getEntry(def);
  if (!entry) return result;
  const profileById = new Map(profiles.map((p) => [p.id, p]));

  for (const run of runs) {
    if (run.status !== "active") continue;
    const p = profileById.get(run.customer_id);
    if (!p) continue;
    const next = processRun(
      def, p, journey.name, run.entered_at, asPosition(run.position), run.due_at, orders, now,
    );
    const changed =
      next.status !== run.status ||
      next.due_at !== run.due_at ||
      JSON.stringify(next.position) !== JSON.stringify(asPosition(run.position)) ||
      next.actions.length > 0;
    if (changed) result.updates.push({ id: run.id, ...next });
  }

  const windowOpen =
    !journey.run_until || now.getTime() <= new Date(journey.run_until).getTime();
  if (windowOpen) {
    const enrolled = new Set(runs.map((r) => r.customer_id));
    for (const p of profiles) {
      if (enrolled.has(p.id)) continue;
      if (!entryMatches(entry, p, now)) continue;
      const first = processRun(def, p, journey.name, now.toISOString(), null, null, orders, now);
      result.enroll.push({ customer_id: p.id, ...first });
    }
  }

  return result;
}
