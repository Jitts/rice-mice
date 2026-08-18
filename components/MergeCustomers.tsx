"use client";

// Sprint 48: the merge screen.
//
// Deliberately three steps rather than one button. A merge deletes a customer
// row and moves their orders, and it is the only place in the app that can turn
// an opt-in on without the customer acting — so the person doing it sees
// exactly what changes before they commit, not a confirmation dialog that says
// "are you sure?".

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  previewMerge,
  mergeCustomers,
  type MergePreviewResult,
} from "@/app/actions/customerMerge";
import { OPT_IN_LABELS, type OptInChannel } from "@/lib/customerMerge";

export type PickerCustomer = {
  id: string;
  first_name: string;
  last_name: string;
  phone: string | null;
  email: string | null;
};

type Preview = Extract<MergePreviewResult, { ok: true }>;

function label(c: PickerCustomer): string {
  return `${c.first_name} ${c.last_name}`.trim() || "(no name)";
}

function handle(c: PickerCustomer): string {
  return [c.phone, c.email].filter(Boolean).join(" · ") || "no phone or email";
}

const inputClass =
  "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm";

export function MergeCustomers({
  customers,
  initialSurvivor,
  initialAbsorbed,
}: {
  customers: PickerCustomer[];
  initialSurvivor?: string;
  initialAbsorbed?: string;
}) {
  const router = useRouter();
  const byId = useMemo(
    () => new Map(customers.map((c) => [c.id, c])),
    [customers],
  );
  const [survivorId, setSurvivorId] = useState<string | null>(
    initialSurvivor && byId.has(initialSurvivor) ? initialSurvivor : null,
  );
  const [absorbedId, setAbsorbedId] = useState<string | null>(
    initialAbsorbed && byId.has(initialAbsorbed) ? initialAbsorbed : null,
  );
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ survivorId: string; orders: number } | null>(null);

  function clearPreview() {
    setPreview(null);
    setError(null);
  }

  async function onCompare() {
    if (!survivorId || !absorbedId) return;
    setBusy(true);
    setError(null);
    let res: MergePreviewResult;
    try {
      res = await previewMerge(survivorId, absorbedId);
    } catch (e) {
      setBusy(false);
      setError(
        `Couldn't read those two records — the server stopped responding${
          e instanceof Error && e.message ? ` (${e.message})` : ""
        }. Nothing was changed.`,
      );
      return;
    }
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setPreview(res);
  }

  async function onMerge() {
    if (!survivorId || !absorbedId) return;
    setBusy(true);
    setError(null);
    // As everywhere else that writes: a timeout REJECTS rather than returning a
    // failure, and without this the button sits on "Merging…" forever after an
    // action that deletes a customer row. "Did that happen or not?" is the worst
    // question to leave unanswered here.
    let res: Awaited<ReturnType<typeof mergeCustomers>>;
    try {
      res = await mergeCustomers(survivorId, absorbedId);
    } catch (e) {
      setBusy(false);
      setError(
        `The merge didn't finish — the server stopped responding${
          e instanceof Error && e.message ? ` (${e.message})` : ""
        }. It runs as a single transaction, so it either completed or did nothing; reload this page to see which.`,
      );
      return;
    }
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setDone({ survivorId: res.survivorId, orders: res.moved.orders });
    setPreview(null);
    router.refresh();
  }

  if (done)
    return (
      <div className="rounded-xl border border-border bg-card p-6 space-y-3">
        <h2 className="font-semibold">Merged</h2>
        <p className="text-sm text-muted-foreground">
          The two records are now one. {done.orders} orders moved across, and the record
          that was absorbed has been removed.
        </p>
        <div className="flex flex-wrap gap-3 pt-1">
          <Link
            href={`/dashboard/customers/${done.survivorId}`}
            className="text-sm bg-primary text-primary-foreground rounded-lg px-4 py-2 hover:bg-primary/90"
          >
            See the customer
          </Link>
          <button
            type="button"
            onClick={() => {
              setDone(null);
              setSurvivorId(null);
              setAbsorbedId(null);
            }}
            className="text-sm text-muted-foreground hover:text-foreground underline"
          >
            Merge another pair
          </button>
        </div>
      </div>
    );

  return (
    <div className="space-y-4">
      {error && (
        <p className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="grid md:grid-cols-2 gap-4">
        <Picker
          title="Keep this record"
          hint="Its id stays, and anything the other record has that this one is missing gets filled in."
          customers={customers}
          selected={survivorId}
          exclude={absorbedId}
          onSelect={(id) => {
            setSurvivorId(id);
            clearPreview();
          }}
        />
        <Picker
          title="Merge this one into it"
          hint="Its orders, messages and sign-up history move across. The record itself is deleted."
          customers={customers}
          selected={absorbedId}
          exclude={survivorId}
          onSelect={(id) => {
            setAbsorbedId(id);
            clearPreview();
          }}
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={!survivorId || !absorbedId || busy}
          onClick={() => void onCompare()}
          className="text-sm bg-primary text-primary-foreground rounded-lg px-4 py-2 hover:bg-primary/90 disabled:opacity-50"
        >
          {busy && !preview ? "Reading…" : "Compare these two"}
        </button>
        {survivorId && absorbedId && (
          <button
            type="button"
            onClick={() => {
              setSurvivorId(absorbedId);
              setAbsorbedId(survivorId);
              clearPreview();
            }}
            className="text-sm text-muted-foreground hover:text-foreground underline"
          >
            Swap which one is kept
          </button>
        )}
      </div>

      {preview && <PreviewPanel preview={preview} busy={busy} onMerge={() => void onMerge()} />}
    </div>
  );
}

function Picker({
  title,
  hint,
  customers,
  selected,
  exclude,
  onSelect,
}: {
  title: string;
  hint: string;
  customers: PickerCustomer[];
  selected: string | null;
  exclude: string | null;
  onSelect: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const chosen = selected ? customers.find((c) => c.id === selected) : null;

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return customers
      .filter((c) => c.id !== exclude)
      .filter((c) =>
        `${c.first_name} ${c.last_name} ${c.phone ?? ""} ${c.email ?? ""}`
          .toLowerCase()
          .includes(q),
      )
      .slice(0, 8);
  }, [query, customers, exclude]);

  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-2">
      <div>
        <h2 className="text-sm font-medium">{title}</h2>
        <p className="text-xs text-muted-foreground mt-0.5">{hint}</p>
      </div>

      {chosen ? (
        <div className="rounded-lg border border-border bg-muted px-3 py-2 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-medium truncate">{label(chosen)}</p>
            <p className="text-xs text-muted-foreground truncate">{handle(chosen)}</p>
          </div>
          <button
            type="button"
            onClick={() => {
              setQuery("");
              onSelect("");
            }}
            className="text-xs text-muted-foreground hover:text-foreground underline whitespace-nowrap"
          >
            Change
          </button>
        </div>
      ) : (
        <>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name, phone or email"
            className={inputClass}
          />
          <ul className="divide-y divide-border/60">
            {matches.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => {
                    setQuery("");
                    onSelect(c.id);
                  }}
                  className="w-full text-left px-1 py-2 hover:bg-muted rounded"
                >
                  <span className="block text-sm truncate">{label(c)}</span>
                  <span className="block text-xs text-muted-foreground truncate">
                    {handle(c)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {query.trim() !== "" && matches.length === 0 && (
            <p className="text-xs text-muted-foreground">Nobody matches that.</p>
          )}
        </>
      )}
    </div>
  );
}

function Row({ field, value }: { field: string; value: string }) {
  return (
    <tr className="border-b border-border/60 last:border-0">
      <td className="px-4 py-2 text-muted-foreground whitespace-nowrap">{field}</td>
      <td className="px-4 py-2">{value || "—"}</td>
    </tr>
  );
}

function PreviewPanel({
  preview,
  busy,
  onMerge,
}: {
  preview: Preview;
  busy: boolean;
  onMerge: () => void;
}) {
  const { plan, counts, absorbed } = preview;
  const f = plan.fields;

  return (
    <div className="space-y-4">
      {plan.inheritedOptIns.length > 0 && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm space-y-1">
          <p>
            <strong>
              This merge switches on{" "}
              {plan.inheritedOptIns.map((c: OptInChannel) => OPT_IN_LABELS[c]).join(" and ")}
            </strong>{" "}
            for the record you&apos;re keeping, because the other one had opted in.
          </p>
          <p className="text-muted-foreground">
            Their sign-up history moves across with them, so the record of when and how
            they agreed survives the merge — and the full consent state of the record
            being removed is written to the audit log first.
          </p>
        </div>
      )}

      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <p className="px-4 py-2.5 text-sm font-medium border-b border-border bg-muted">
          What the kept record looks like afterwards
        </p>
        <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <tbody>
            <Row field="Name" value={`${f.first_name} ${f.last_name}`.trim()} />
            <Row field="Phone" value={f.phone ?? ""} />
            <Row field="Email" value={f.email ?? ""} />
            <Row
              field="Member since"
              value={new Date(f.created_at).toLocaleDateString()}
            />
            <Row
              field="Last visit"
              value={f.last_purchase_date ? new Date(f.last_purchase_date).toLocaleDateString() : ""}
            />
            <Row field="Tags" value={f.tags.join(", ")} />
            <Row
              field="Opted in to"
              value={
                [
                  f.whatsapp_opt_in ? "WhatsApp" : null,
                  f.email_opt_in ? "Email" : null,
                  f.sms_opt_in ? "SMS" : null,
                ]
                  .filter(Boolean)
                  .join(", ") || "nothing"
              }
            />
          </tbody>
        </table>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card p-4 space-y-2">
        <p className="text-sm">
          Moving across: <strong>{counts.orders}</strong> orders,{" "}
          <strong>{counts.messages}</strong> messages,{" "}
          <strong>{counts.signups}</strong> sign-up events. The record for{" "}
          {`${absorbed.first_name} ${absorbed.last_name}`.trim() || "the absorbed customer"}{" "}
          is then deleted.
        </p>
        {plan.notes.length > 0 && (
          <ul className="text-xs text-muted-foreground list-disc pl-4 space-y-0.5">
            {plan.notes.map((n: string) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        )}
      </div>

      <button
        type="button"
        disabled={busy}
        onClick={onMerge}
        className="text-sm bg-destructive text-destructive-foreground rounded-lg px-4 py-2 hover:bg-destructive/90 disabled:opacity-50"
      >
        {busy ? "Merging…" : "Merge them"}
      </button>
      <p className="text-xs text-muted-foreground">
        This can&apos;t be undone. It runs as one transaction, so it either completes or
        changes nothing.
      </p>
    </div>
  );
}
