import { composeMessage, CHANNELS, type CampaignChannel } from "@/lib/campaigns";
import { stageOf, type CustomerProfile, type JourneyStage } from "@/lib/segments";

// Staff-designed journeys. A human LAUNCHES a journey (for N days or evergreen);
// while it runs, the tick enrolls qualifying customers and walks them through a
// branching step tree. The only action is preparing a message draft into the
// action inbox — sending remains a human click, always.

// --- Definition -----------------------------------------------------------------

export type JourneyEntry =
  | { type: "stage"; stage: JourneyStage }
  | { type: "no_visit"; days: number }
  | { type: "signed_up"; days: number }
  | { type: "birthday_month" }
  | { type: "tag"; tag: string };

export type BranchCondition = "visited_since_entry" | "not_visited_since_entry";

export type JourneyStep =
  | { type: "wait"; days: number }
  | { type: "message"; channel: CampaignChannel; body: string }
  | { type: "branch"; condition: BranchCondition; yes: JourneyStep[]; no: JourneyStep[] };

export type JourneyDefinition = {
  entry: JourneyEntry;
  steps: JourneyStep[];
  exitOnOrder: boolean;
};

export const EMPTY_JOURNEY: JourneyDefinition = {
  entry: { type: "stage", stage: "at_risk" },
  steps: [],
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

// The cursor into the step tree: indices, descending into branches via
// "yes"/"no" frames, e.g. [1, "yes", 0] = first step of step 1's yes path.
export type PositionPath = (number | "yes" | "no")[];

export type JourneyRun = {
  id: string;
  journey_id: string;
  customer_id: string;
  entered_at: string;
  position: PositionPath;
  due_at: string | null;
  status: "active" | "completed" | "exited";
};

export type MessagePayload = {
  channel: CampaignChannel;
  body: string; // fully rendered, incl. unsubscribe footer
  address: string;
  journey_name: string;
};

// --- Entry matching ---------------------------------------------------------------

const DAY_MS = 86400000;

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
      return (
        !!p.birthday &&
        new Date(p.birthday).getUTCMonth() === now.getUTCMonth()
      );
    case "tag":
      return p.tags.includes(entry.tag);
  }
}

// --- Step-tree cursor ---------------------------------------------------------------

export function stepAt(steps: JourneyStep[], path: PositionPath): JourneyStep | null {
  let list = steps;
  for (let i = 0; i < path.length; i++) {
    const seg = path[i];
    if (seg === "yes" || seg === "no") continue;
    const step = list[seg];
    if (!step) return null;
    if (i === path.length - 1) return step;
    if (step.type !== "branch") return null;
    const key = path[i + 1];
    list = key === "yes" ? step.yes : step.no;
  }
  return null;
}

// Advance the cursor past the step it points at; popping out of finished
// branch paths back to the parent level. Empty result = end of journey.
export function advancePath(steps: JourneyStep[], path: PositionPath): PositionPath {
  const next = [...path];
  while (next.length > 0) {
    const lastIdx = next.length - 1;
    const idx = next[lastIdx] as number;
    const candidate = [...next.slice(0, lastIdx), idx + 1];
    if (stepAt(steps, candidate)) return candidate;
    // finished this list: pop a branch frame ([..., branchIdx, "yes"/"no", idx])
    if (next.length >= 3) {
      next.splice(next.length - 2, 2); // drop key + idx, leaving the branch index
      continue;
    }
    return []; // past the end at root level
  }
  return [];
}

// --- The tick (pure) -----------------------------------------------------------------

export type TickOrder = {
  customer_id: string | null;
  status: string;
  created_at: string;
};

export type TickEnroll = {
  customer_id: string;
  position: PositionPath;
  due_at: string | null;
  status: JourneyRun["status"];
  actions: MessagePayload[];
};

export type TickUpdate = {
  id: string;
  position: PositionPath;
  due_at: string | null;
  status: JourneyRun["status"];
  actions: MessagePayload[];
};

export type TickResult = { enroll: TickEnroll[]; updates: TickUpdate[] };

function orderedSince(
  orders: TickOrder[],
  customerId: string,
  sinceIso: string,
): boolean {
  const since = new Date(sinceIso).getTime();
  return orders.some(
    (o) =>
      o.customer_id === customerId &&
      o.status === "completed" &&
      new Date(o.created_at).getTime() > since,
  );
}

// Walk one run forward from its position until it hits a pending wait, the
// end of the tree, or an exit. Returns the run's new state plus any message
// actions produced along the way.
function processRun(
  def: JourneyDefinition,
  profile: CustomerProfile,
  journeyName: string,
  enteredAt: string,
  startPosition: PositionPath,
  startDue: string | null,
  orders: TickOrder[],
  now: Date,
): { position: PositionPath; due_at: string | null; status: JourneyRun["status"]; actions: MessagePayload[] } {
  const actions: MessagePayload[] = [];
  let position = startPosition;
  let due = startDue;

  if (def.exitOnOrder && orderedSince(orders, profile.id, enteredAt)) {
    return { position, due_at: null, status: "exited", actions };
  }
  if (due && new Date(due).getTime() > now.getTime()) {
    return { position, due_at: due, status: "active", actions };
  }
  due = null;

  for (let guard = 0; guard < 100; guard++) {
    const step = position.length === 0 ? def.steps[0] ?? null : stepAt(def.steps, position);
    const path: PositionPath = position.length === 0 ? (def.steps.length ? [0] : []) : position;
    if (!step) return { position: path, due_at: null, status: "completed", actions };

    if (step.type === "wait") {
      const nextPos = advancePath(def.steps, path);
      // A wait with nothing after it has nothing to wait for — complete now.
      // (Position [] only ever means "start", so a done run must never carry it
      // with active status.)
      if (nextPos.length === 0) {
        return { position: path, due_at: null, status: "completed", actions };
      }
      return {
        position: nextPos,
        due_at: new Date(now.getTime() + step.days * DAY_MS).toISOString(),
        status: "active",
        actions,
      };
    }

    if (step.type === "message") {
      // Consent + contact enforced here: unreachable customers simply produce
      // no draft, and the flow continues.
      const channel = CHANNELS.find((c) => c.id === step.channel);
      const address = channel ? channel.address(profile) : null;
      if (address) {
        actions.push({
          channel: step.channel,
          body: composeMessage(step.body, profile),
          address,
          journey_name: journeyName,
        });
      }
      position = advancePath(def.steps, path);
      if (position.length === 0) return { position, due_at: null, status: "completed", actions };
      continue;
    }

    // branch
    const visited = orderedSince(orders, profile.id, enteredAt);
    const takeYes = step.condition === "visited_since_entry" ? visited : !visited;
    const key: "yes" | "no" = takeYes ? "yes" : "no";
    const branchList = takeYes ? step.yes : step.no;
    if (branchList.length > 0) {
      position = [...path, key, 0];
    } else {
      position = advancePath(def.steps, path);
      if (position.length === 0) return { position, due_at: null, status: "completed", actions };
    }
  }
  return { position, due_at: null, status: "completed", actions };
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
  const profileById = new Map(profiles.map((p) => [p.id, p]));

  // 1. Advance existing active runs whose wait is over (or that just entered).
  for (const run of runs) {
    if (run.status !== "active") continue;
    const p = profileById.get(run.customer_id);
    if (!p) continue;
    const next = processRun(
      def, p, journey.name, run.entered_at, run.position, run.due_at, orders, now,
    );
    const changed =
      next.status !== run.status ||
      next.due_at !== run.due_at ||
      JSON.stringify(next.position) !== JSON.stringify(run.position) ||
      next.actions.length > 0;
    if (changed) result.updates.push({ id: run.id, ...next });
  }

  // 2. Enroll new matches — unless the run window has closed (in-flight runs
  //    above still finish; the journey just stops taking new customers).
  const windowOpen = !journey.run_until || now.getTime() <= new Date(journey.run_until).getTime();
  if (windowOpen) {
    const enrolled = new Set(runs.map((r) => r.customer_id));
    for (const p of profiles) {
      if (enrolled.has(p.id)) continue;
      if (!entryMatches(def.entry, p, now)) continue;
      const nowIso = now.toISOString();
      const first = processRun(def, p, journey.name, nowIso, [], null, orders, now);
      result.enroll.push({ customer_id: p.id, ...first });
    }
  }

  return result;
}
