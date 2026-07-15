"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { CURRENCY } from "@/lib/format";
import { rewardBenefitLabel, type Reward } from "@/lib/loyalty";

type Draft = {
  id: string | null; // null = creating
  name: string;
  description: string;
  points_cost: string;
  benefit_type: "percent" | "amount";
  benefit_value: string; // percent whole number, or dollars (converted to cents)
  active: boolean;
};

const EMPTY_DRAFT: Draft = {
  id: null,
  name: "",
  description: "",
  points_cost: "20",
  benefit_type: "amount",
  benefit_value: "5",
  active: true,
};

// Owner-defined loyalty rewards. A reward is a points cost + a discount the
// staff applies at the order pad; earning and spending are derived, so nothing
// here touches customer balances directly.
export function RewardsManager({ rewards }: { rewards: Reward[] }) {
  const router = useRouter();
  const [supabase] = useState(() => createClient());
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function editDraft(r: Reward) {
    setDraft({
      id: r.id,
      name: r.name,
      description: r.description ?? "",
      points_cost: String(r.points_cost),
      benefit_type: r.benefit_type,
      benefit_value:
        r.benefit_type === "amount"
          ? (r.benefit_value / 100).toFixed(2)
          : String(r.benefit_value),
      active: r.active,
    });
  }

  async function saveDraft() {
    if (!draft) return;
    const name = draft.name.trim();
    const pointsCost = Math.round(Number(draft.points_cost));
    const rawValue = Number(draft.benefit_value);
    const benefitValue =
      draft.benefit_type === "amount" ? Math.round(rawValue * 100) : Math.round(rawValue);

    if (!name) return setError("Give the reward a name.");
    if (!Number.isFinite(pointsCost) || pointsCost < 1)
      return setError("Points cost must be at least 1.");
    if (!Number.isFinite(benefitValue) || benefitValue < 1)
      return setError("The discount must be above 0.");
    if (draft.benefit_type === "percent" && benefitValue > 100)
      return setError("A percentage can't be over 100.");

    setBusy(true);
    setError(null);
    const payload = {
      name,
      description: draft.description.trim() || null,
      points_cost: pointsCost,
      benefit_type: draft.benefit_type,
      benefit_value: benefitValue,
      active: draft.active,
      updated_at: new Date().toISOString(),
    };
    const { error: err } = draft.id
      ? await supabase.from("rewards").update(payload).eq("id", draft.id)
      : await supabase.from("rewards").insert(payload);
    setBusy(false);
    if (err) {
      setError(err.message);
      return;
    }
    setDraft(null);
    router.refresh();
  }

  async function deleteReward(r: Reward) {
    if (!confirm(`Delete the reward “${r.name}”?`)) return;
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.from("rewards").delete().eq("id", r.id);
    setBusy(false);
    if (err) {
      setError(err.message);
      return;
    }
    router.refresh();
  }

  return (
    <div className="space-y-3">
      {rewards.length > 0 && (
        <div className="rounded-lg border border-border divide-y">
          {rewards.map((r) => (
            <div key={r.id} className="px-3 py-2.5 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium">
                  {r.name}
                  <span className="ml-2 text-xs bg-violet-100 text-violet-700 rounded-full px-2 py-0.5">
                    {r.points_cost} pts → {rewardBenefitLabel(r)}
                  </span>
                  {!r.active && (
                    <span className="ml-2 text-xs bg-muted text-muted-foreground rounded-full px-2 py-0.5">
                      inactive
                    </span>
                  )}
                </p>
                {r.description && (
                  <p className="text-xs text-muted-foreground mt-0.5">{r.description}</p>
                )}
              </div>
              <div className="flex gap-2 shrink-0">
                <button
                  onClick={() => editDraft(r)}
                  className="text-xs text-muted-foreground underline hover:text-foreground"
                >
                  edit
                </button>
                <button
                  onClick={() => deleteReward(r)}
                  disabled={busy}
                  className="text-xs text-muted-foreground/70 underline hover:text-destructive"
                >
                  delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {draft ? (
        <div className="rounded-lg border border-input p-3 space-y-3 bg-muted">
          <div className="flex flex-wrap gap-3">
            <label className="block text-sm">
              <span className="block text-xs text-muted-foreground mb-1">Reward name</span>
              <input
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder="Free coffee"
                className="border border-input rounded px-2 py-1.5 text-sm w-48 bg-card"
              />
            </label>
            <label className="block text-sm flex-1 min-w-48">
              <span className="block text-xs text-muted-foreground mb-1">Description (optional)</span>
              <input
                value={draft.description}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                placeholder="What the customer gets"
                className="border border-input rounded px-2 py-1.5 text-sm w-full bg-card"
              />
            </label>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <label className="block text-sm">
              <span className="block text-xs text-muted-foreground mb-1">Points cost</span>
              <input
                type="number"
                min={1}
                value={draft.points_cost}
                onChange={(e) => setDraft({ ...draft, points_cost: e.target.value })}
                className="border border-input rounded px-2 py-1.5 text-sm w-24 bg-card"
              />
            </label>
            <label className="block text-sm">
              <span className="block text-xs text-muted-foreground mb-1">Benefit</span>
              <select
                value={draft.benefit_type}
                onChange={(e) =>
                  setDraft({ ...draft, benefit_type: e.target.value as "percent" | "amount" })
                }
                className="border border-input rounded px-2 py-1.5 text-sm bg-card"
              >
                <option value="amount">{CURRENCY} off</option>
                <option value="percent">% off</option>
              </select>
            </label>
            <label className="block text-sm">
              <span className="block text-xs text-muted-foreground mb-1">
                {draft.benefit_type === "amount" ? `Amount (${CURRENCY})` : "Percent"}
              </span>
              <input
                type="number"
                min={draft.benefit_type === "amount" ? 0.01 : 1}
                step={draft.benefit_type === "amount" ? 0.5 : 1}
                max={draft.benefit_type === "percent" ? 100 : undefined}
                value={draft.benefit_value}
                onChange={(e) => setDraft({ ...draft, benefit_value: e.target.value })}
                className="border border-input rounded px-2 py-1.5 text-sm w-24 bg-card"
              />
            </label>
            <label className="flex items-center gap-1.5 text-sm text-muted-foreground pb-1.5">
              <input
                type="checkbox"
                checked={draft.active}
                onChange={(e) => setDraft({ ...draft, active: e.target.checked })}
              />
              Active
            </label>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={saveDraft}
              disabled={busy || !draft.name.trim()}
              className="text-sm bg-primary text-primary-foreground rounded px-3 py-1.5 disabled:opacity-50"
            >
              {busy ? "Saving…" : draft.id ? "Save reward" : "Create reward"}
            </button>
            <button
              onClick={() => {
                setDraft(null);
                setError(null);
              }}
              className="text-sm border border-input rounded px-3 py-1.5 text-muted-foreground"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setDraft(EMPTY_DRAFT)}
          className="text-sm border border-input rounded-lg px-4 py-2 text-muted-foreground hover:border-ring"
        >
          + New reward
        </button>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
