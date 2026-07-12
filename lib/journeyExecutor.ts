import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildFieldRegistry,
  buildProfiles,
  type CustomerRow,
  type CustomFieldRow,
  type SegmentDefinition,
} from "@/lib/segments";
import { tickJourney, type Journey, type JourneyRun } from "@/lib/journeys";
import type { Order } from "@/lib/orders";

// Runs one journey tick against live data and persists the outcome. Called on
// page load (dashboard inbox + campaigns page) — the unique
// (journey_id, customer_id) constraint makes concurrent ticks from two devices
// harmless: duplicate enrollments are silently dropped.
export async function runJourneyTick(
  supabase: SupabaseClient,
): Promise<{ enrolled: number; actionsCreated: number }> {
  const { data: journeys } = await supabase
    .from("journeys")
    .select("*")
    .eq("status", "running");
  if (!journeys || journeys.length === 0) return { enrolled: 0, actionsCreated: 0 };

  const ids = journeys.map((j) => j.id);
  const [{ data: runs }, { data: customers }, { data: orders }, { data: segments }, { data: customFields }] =
    await Promise.all([
      supabase.from("journey_runs").select("*").in("journey_id", ids),
      supabase.from("customers").select("*"),
      supabase.from("orders").select("*, order_items(*)"),
      supabase.from("segments").select("id, definition"),
      supabase.from("custom_fields").select("*"),
    ]);

  const profiles = buildProfiles(
    (customers ?? []) as CustomerRow[],
    (orders ?? []) as Order[],
  );
  const tickOrders = (orders ?? []).map((o) => ({
    customer_id: o.customer_id,
    status: o.status,
    created_at: o.created_at,
  }));
  const segmentsById: Record<string, SegmentDefinition> = Object.fromEntries(
    (segments ?? []).map((s) => [s.id, s.definition as SegmentDefinition]),
  );
  const fieldsById = buildFieldRegistry((customFields ?? []) as CustomFieldRow[]).byId;

  let enrolled = 0;
  let actionsCreated = 0;

  for (const journey of journeys as Journey[]) {
    const journeyRuns = ((runs ?? []) as JourneyRun[]).filter(
      (r) => r.journey_id === journey.id,
    );
    const result = tickJourney(
      journey, journeyRuns, profiles, tickOrders, segmentsById, fieldsById,
    );

    for (const u of result.updates) {
      // position is NOT NULL in the DB; a finished run's null cursor maps to [].
      const { error: uErr } = await supabase
        .from("journey_runs")
        .update({ position: u.position ?? [], due_at: u.due_at, status: u.status })
        .eq("id", u.id);
      if (uErr) console.error("journey tick: run update failed", uErr.message);
      if (u.actions.length > 0) {
        const run = journeyRuns.find((r) => r.id === u.id);
        await supabase.from("journey_actions").insert(
          u.actions.map((payload) => ({
            run_id: u.id,
            journey_id: journey.id,
            customer_id: run?.customer_id,
            kind: "message",
            payload,
          })),
        );
        actionsCreated += u.actions.length;
      }
    }

    if (result.enroll.length > 0) {
      const rows = result.enroll.map((e) => ({
        id: crypto.randomUUID(),
        journey_id: journey.id,
        customer_id: e.customer_id,
        position: e.position ?? [],
        due_at: e.due_at,
        status: e.status,
      }));
      const { data: inserted, error: iErr } = await supabase
        .from("journey_runs")
        .upsert(rows, { onConflict: "journey_id,customer_id", ignoreDuplicates: true })
        .select();
      if (iErr) console.error("journey tick: enrollment failed", iErr.message);
      const insertedByCustomer = new Map(
        (inserted ?? []).map((r) => [r.customer_id as string, r.id as string]),
      );
      enrolled += inserted?.length ?? 0;

      const actionRows = result.enroll.flatMap((e) => {
        const runId = insertedByCustomer.get(e.customer_id);
        if (!runId) return []; // lost the race to another device — its tick owns the actions
        return e.actions.map((payload) => ({
          run_id: runId,
          journey_id: journey.id,
          customer_id: e.customer_id,
          kind: "message",
          payload,
        }));
      });
      if (actionRows.length > 0) {
        await supabase.from("journey_actions").insert(actionRows);
        actionsCreated += actionRows.length;
      }
    }
  }

  return { enrolled, actionsCreated };
}
