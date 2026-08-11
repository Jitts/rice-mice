"use client";

// Sprint 46: preview-then-commit order-history import.
//
// The counts that matter here are different from the customer import's. There,
// the number to check before committing was "how many arrive opted out". Here
// it is "how many receipts actually found a customer" — an import that writes
// 250 orders attached to nobody looks successful and changes nothing, so the
// preview leads with attachment and names every receipt it couldn't place.

import { useMemo, useState } from "react";
import Link from "next/link";
import { parseCsv, type CsvTable } from "@/lib/csv";
import {
  autoMapOrderColumns,
  buildItemIndex,
  groupIntoOrders,
  parseOrderLines,
  resolveOrders,
  summarizeOrders,
  ORDER_LABELS,
  type CatalogItem,
  type ExistingCustomerRef,
  type OrderColumnMapping,
  type OrderImportSummary,
  type OrderTargetId,
  type UnmatchedPolicy,
} from "@/lib/orderImport";
import { inferDateOrder, type DateOrder } from "@/lib/customerImport";
import { columnValues } from "@/lib/csv";
import { importOrders } from "@/app/actions/orderImport";
import { downloadText } from "@/lib/segmentExport";
import { JOURNEY_LABELS, JOURNEY_ORDER, type JourneyStage } from "@/lib/segments";

type Step = "upload" | "map" | "preview" | "done";

// One receipt over two lines, then a single-line receipt with no customer —
// enough to show that the receipt number is what groups lines into an order.
const TEMPLATE_CSV = [
  "Receipt Number,Date,Time,Customer Email,Customer Phone,Item,Qty,Unit Price,Discount,Line Total,Payment Method,Status",
  "R-1044,2025-01-14,12:31:02,amara@example.com,+65 9123 4567,Rice Bowl (Large),1,8.50,,8.50,Card,Completed",
  "R-1044,2025-01-14,12:31:02,amara@example.com,+65 9123 4567,Iced Tea,2,2.80,1.00,4.60,Card,Completed",
  "R-1045,2025-01-14,12:48:19,,,Kaya Toast,1,3.20,,3.20,Cash,Completed",
].join("\r\n");

const ORDER_IDS = Object.keys(ORDER_LABELS) as OrderTargetId[];

const selectClass =
  "rounded-lg border border-border bg-background px-2 py-1.5 text-sm";

function money(cents: number): string {
  return (cents / 100).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

// The shop's own clock. Whoever is running the import is standing in the shop,
// so their browser offset is the right default — and Date's getTimezoneOffset
// is inverted relative to how everyone says it out loud (+480 for UTC+8).
function browserOffsetMinutes(): number {
  return -new Date().getTimezoneOffset();
}

function offsetLabel(minutes: number): string {
  const sign = minutes < 0 ? "-" : "+";
  const abs = Math.abs(minutes);
  return `UTC${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
}

const OFFSET_CHOICES = [-480, -300, -240, 0, 60, 120, 240, 330, 420, 480, 540, 600];

export function OrderImportWizard({
  existingCustomers,
  catalog,
  existingRefs,
  customerCount,
}: {
  existingCustomers: ExistingCustomerRef[];
  catalog: CatalogItem[];
  existingRefs: string[];
  customerCount: number;
}) {
  const [step, setStep] = useState<Step>("upload");
  const [filename, setFilename] = useState("");
  const [fileSize, setFileSize] = useState(0);
  const [csvText, setCsvText] = useState("");
  const [table, setTable] = useState<CsvTable | null>(null);
  const [mappings, setMappings] = useState<OrderColumnMapping[]>([]);
  const [policy, setPolicy] = useState<UnmatchedPolicy>("skip");
  // Sprint 48. Off by default: adding people to a CRM is not something to do
  // by accident, and the preview has to be able to show the count first.
  const [createCustomers, setCreateCustomers] = useState(false);
  const [offset, setOffset] = useState<number>(() => browserOffsetMinutes());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<OrderImportSummary | null>(null);
  const [stages, setStages] = useState<Record<JourneyStage, number> | null>(null);
  // The import succeeded but something after the orders didn't. Kept separate
  // from `error`, which means nothing was written.
  const [warning, setWarning] = useState<string | null>(null);

  const itemIndex = useMemo(() => buildItemIndex(catalog), [catalog]);

  // first_name and last_name are NOT NULL, so without one of these columns the
  // import can attach orders to people already on file but can never add anyone.
  // Better to say that plainly than to offer a checkbox that quietly does
  // nothing.
  const hasNameColumn = useMemo(
    () =>
      mappings.some(
        (m) =>
          m.target.kind === "builtin" &&
          (m.target.id === "customer_name" ||
            m.target.id === "customer_first_name" ||
            m.target.id === "customer_last_name"),
      ),
    [mappings],
  );
  // The checkbox can be left ticked while the user goes back and unmaps the
  // name column; the file, not the checkbox, is what decides.
  const willCreate = createCustomers && hasNameColumn;

  function reset() {
    setStep("upload");
    setFilename("");
    setFileSize(0);
    setCsvText("");
    setTable(null);
    setMappings([]);
    setError(null);
    setResult(null);
    setStages(null);
    setWarning(null);
  }

  const preview = useMemo(() => {
    if (!table || mappings.length === 0) return null;
    const lines = parseOrderLines(table, mappings);
    const { orders, errored } = groupIntoOrders(lines, offset);
    const { resolved, newCustomers } = resolveOrders(
      orders,
      existingCustomers,
      existingRefs,
      policy,
      willCreate,
    );
    return {
      resolved,
      newCustomers,
      errored,
      summary: summarizeOrders(resolved, errored, lines, itemIndex, newCustomers),
    };
  }, [
    table,
    mappings,
    policy,
    willCreate,
    offset,
    existingCustomers,
    existingRefs,
    itemIndex,
  ]);

  async function onFile(file: File | null) {
    if (!file) return;
    setError(null);
    const text = await file.text();
    const parsed = parseCsv(text);
    if (parsed.headers.length === 0 || parsed.rows.length === 0) {
      setError("That file has no header row and data rows we can read.");
      return;
    }
    setFilename(file.name);
    setFileSize(file.size);
    setCsvText(text);
    setTable(parsed);
    setMappings(autoMapOrderColumns(parsed));
    setStep("map");
  }

  function setTarget(index: number, value: string) {
    setMappings((ms) =>
      ms.map((m) => {
        if (m.index !== index) return m;
        if (value === "ignore")
          return { header: m.header, index: m.index, target: { kind: "ignore" } };
        const id = value.replace("builtin:", "") as OrderTargetId;
        const next: OrderColumnMapping = {
          header: m.header,
          index: m.index,
          target: { kind: "builtin", id },
        };
        if (id === "ordered_at")
          next.dateOrder = table ? inferDateOrder(columnValues(table, m.index)) : "iso";
        return next;
      }),
    );
  }

  function setDateOrder(index: number, dateOrder: DateOrder) {
    setMappings((ms) => ms.map((m) => (m.index === index ? { ...m, dateOrder } : m)));
  }

  const mappedIds = useMemo(
    () =>
      new Set(
        mappings.flatMap((m) => (m.target.kind === "builtin" ? [m.target.id] : [])),
      ),
    [mappings],
  );

  async function commit() {
    setBusy(true);
    setError(null);
    // A server action can fail without RETURNING a failure: a timeout, a 503,
    // or a dropped connection rejects the promise instead. Without this catch,
    // `setBusy(false)` never runs and the button sits on "Importing…" forever,
    // with nothing on screen to say the import died. Seen in production on a
    // 281-order file: the request 503'd and the wizard hung silently.
    let res: Awaited<ReturnType<typeof importOrders>>;
    try {
      res = await importOrders({
        filename,
        csvText,
        mappings,
        policy,
        utcOffsetMinutes: offset,
        createCustomers: willCreate,
      });
    } catch (e) {
      setBusy(false);
      setError(
        `The import didn't finish — the server stopped responding${
          e instanceof Error && e.message ? ` (${e.message})` : ""
        }. Large files can take a while; check whether the orders arrived before running it again, since re-importing already-imported receipts is safe but a half-finished run is not obvious from here.`,
      );
      return;
    }
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setResult(res.summary);
    setStages(res.stages);
    setWarning(res.warning);
    setStep("done");
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-bold tracking-tight">
            Import order history
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Past sales from your POS, matched to the customers you already have.
          </p>
        </div>
        <Link href="/dashboard" className="text-sm text-muted-foreground hover:text-foreground">
          Cancel
        </Link>
      </div>

      <Steps step={step} />

      {table && step !== "upload" && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3">
          <div className="min-w-0">
            <p className="text-sm font-medium truncate" title={filename}>
              {step === "done" ? "Imported from " : ""}
              {filename}
            </p>
            <p className="text-xs text-muted-foreground">
              {table.rows.length.toLocaleString()} rows · {table.headers.length} columns
              {fileSize > 0 && ` · ${formatSize(fileSize)}`}
              {preview && ` · ${preview.summary.orders.toLocaleString()} receipts`}
            </p>
          </div>
          <button
            type="button"
            onClick={reset}
            className="text-sm text-muted-foreground hover:text-foreground underline whitespace-nowrap"
          >
            {step === "done" ? "Import another file" : "Choose a different file"}
          </button>
        </div>
      )}

      {error && (
        <p className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </p>
      )}

      {step === "upload" && (
        <div className="space-y-4">
          {customerCount === 0 && (
            <p className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
              You don&apos;t have any customers yet, so there is nothing for these orders
              to attach to.{" "}
              <Link href="/dashboard/customers/import" className="underline">
                Import your customer list first
              </Link>
              .
            </p>
          )}

          <div className="rounded-xl border border-border bg-card p-6 space-y-4">
            <div>
              <h2 className="font-semibold">Choose your sales export</h2>
              <p className="text-sm text-muted-foreground mt-1">
                A transactions or items export from your POS. One row per line item is
                normal — rows sharing a receipt number are grouped into one order.
              </p>
            </div>
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => void onFile(e.target.files?.[0] ?? null)}
              className="block w-full text-sm file:mr-4 file:rounded-lg file:border-0 file:bg-primary file:px-4 file:py-2 file:text-sm file:text-primary-foreground hover:file:bg-primary/90"
            />
            <p className="text-xs text-muted-foreground">
              You&apos;ll match up the columns and see exactly what will happen before
              anything is saved.{" "}
              <button
                type="button"
                onClick={() => downloadText("rice-mice-order-template.csv", TEMPLATE_CSV)}
                className="underline hover:text-foreground"
              >
                Download a template
              </button>
            </p>
          </div>

          <OrderFormatGuide />
        </div>
      )}

      {step === "map" && table && (
        <div className="space-y-4">
          {!mappedIds.has("ordered_at") && (
            <p className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              No date column is mapped. Every order needs a date to sit anywhere in a
              customer&apos;s history.
            </p>
          )}
          {!mappedIds.has("customer_email") && !mappedIds.has("customer_phone") && (
            <p className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
              No customer email or phone column is mapped, so none of these orders can be
              matched to a customer — nothing in the dashboard would change.
            </p>
          )}

          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b border-border bg-muted text-muted-foreground">
                  <th className="px-4 py-2.5 font-medium">Column in your file</th>
                  <th className="px-4 py-2.5 font-medium">Example</th>
                  <th className="px-4 py-2.5 font-medium">Import as</th>
                </tr>
              </thead>
              <tbody>
                {mappings.map((m) => {
                  const sample =
                    table.rows.find((r) => (r[m.index] ?? "").trim() !== "")?.[m.index] ?? "";
                  const value =
                    m.target.kind === "builtin" ? `builtin:${m.target.id}` : "ignore";
                  return (
                    <tr key={m.index} className="border-b border-border/60 last:border-0">
                      <td className="px-4 py-2.5 font-medium">
                        {m.header || `Column ${m.index + 1}`}
                      </td>
                      <td className="px-4 py-2.5 text-muted-foreground truncate max-w-[12rem]">
                        {sample}
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <select
                            value={value}
                            onChange={(e) => setTarget(m.index, e.target.value)}
                            className={selectClass}
                          >
                            {ORDER_IDS.map((id) => (
                              <option key={id} value={`builtin:${id}`}>
                                {ORDER_LABELS[id]}
                              </option>
                            ))}
                            <option value="ignore">Don&apos;t import</option>
                          </select>
                          {m.dateOrder && (
                            <select
                              value={m.dateOrder}
                              onChange={(e) => setDateOrder(m.index, e.target.value as DateOrder)}
                              className={selectClass}
                            >
                              <option value="iso">YYYY-MM-DD</option>
                              <option value="dmy">DD/MM/YYYY</option>
                              <option value="mdy">MM/DD/YYYY</option>
                            </select>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <fieldset className="rounded-xl border border-border bg-card p-4">
              <legend className="px-1 text-sm font-medium">
                Orders we can&apos;t match to a customer
              </legend>
              <div className="flex flex-col gap-2 mt-1">
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="radio"
                    checked={policy === "skip"}
                    onChange={() => setPolicy("skip")}
                    className="mt-1"
                  />
                  <span>
                    Leave them out
                    <span className="block text-xs text-muted-foreground">
                      Walk-ins and receipts for people who aren&apos;t in your customer
                      list. You can import them later.
                    </span>
                  </span>
                </label>
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="radio"
                    checked={policy === "unattached"}
                    onChange={() => setPolicy("unattached")}
                    className="mt-1"
                  />
                  <span>
                    Import as walk-in sales
                    <span className="block text-xs text-muted-foreground">
                      They count towards your sales reports but not towards anyone&apos;s
                      history.
                    </span>
                  </span>
                </label>

                <label className="flex items-start gap-2 text-sm border-t border-border pt-2 mt-1">
                  <input
                    type="checkbox"
                    checked={createCustomers && hasNameColumn}
                    disabled={!hasNameColumn}
                    onChange={(e) => setCreateCustomers(e.target.checked)}
                    className="mt-1"
                  />
                  <span className={hasNameColumn ? "" : "text-muted-foreground"}>
                    Add the people this file names as customers
                    <span className="block text-xs text-muted-foreground">
                      {hasNameColumn ? (
                        <>
                          {preview
                            ? `${preview.summary.newCustomers} would be added, `
                            : ""}
                          opted out of every channel — a receipt isn&apos;t consent.
                          Their member-since date comes from their first order.
                        </>
                      ) : (
                        <>
                          Needs a customer name column. Map one on the previous step to
                          turn this on.
                        </>
                      )}
                    </span>
                  </span>
                </label>
              </div>
            </fieldset>

            <fieldset className="rounded-xl border border-border bg-card p-4">
              <legend className="px-1 text-sm font-medium">Times in this file are</legend>
              <select
                value={offset}
                onChange={(e) => setOffset(Number(e.target.value))}
                className={`${selectClass} mt-1 w-full`}
              >
                {[...new Set([browserOffsetMinutes(), ...OFFSET_CHOICES])]
                  .sort((a, b) => a - b)
                  .map((o) => (
                    <option key={o} value={o}>
                      {offsetLabel(o)}
                      {o === browserOffsetMinutes() ? " — your clock" : ""}
                    </option>
                  ))}
              </select>
              <p className="text-xs text-muted-foreground mt-2">
                A POS export writes your shop&apos;s clock with no timezone on it. This is
                what stops a late-evening receipt landing on the next day&apos;s sales.
              </p>
            </fieldset>
          </div>

          <div className="flex justify-end">
            <button
              type="button"
              disabled={!mappedIds.has("ordered_at")}
              onClick={() => setStep("preview")}
              className="text-sm bg-primary text-primary-foreground rounded-lg px-4 py-2 hover:bg-primary/90 disabled:opacity-50"
            >
              Preview import
            </button>
          </div>
        </div>
      )}

      {step === "preview" && preview && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Stat label="Orders to add" value={preview.summary.create} />
            <Stat
              label="Attached to a customer"
              value={preview.summary.attachedToCustomers}
            />
            {willCreate ? (
              <Stat label="Customers to add" value={preview.summary.newCustomers} />
            ) : (
              <Stat label="Customers affected" value={preview.summary.customersTouched} />
            )}
            <Stat
              label="Revenue"
              value={money(preview.summary.revenueCents)}
              prefix
            />
          </div>

          <PreviewNotes
            summary={preview.summary}
            policy={policy}
            createCustomers={willCreate}
          />

          <PreviewOrders resolved={preview.resolved} />

          <div className="flex justify-between items-center">
            <button
              type="button"
              onClick={() => setStep("map")}
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              Back to columns
            </button>
            <button
              type="button"
              disabled={busy || preview.summary.create === 0}
              onClick={() => void commit()}
              className="text-sm bg-primary text-primary-foreground rounded-lg px-4 py-2 hover:bg-primary/90 disabled:opacity-50"
            >
              {busy ? "Importing…" : `Import ${preview.summary.create} orders`}
            </button>
          </div>
        </div>
      )}

      {step === "done" && result && (
        <div className="space-y-4">
          <div className="rounded-xl border border-border bg-card p-6 space-y-3">
            <h2 className="font-semibold">Import finished</h2>
            <p className="text-sm text-muted-foreground">
              {/* Both kinds of attachment, or a POS-only import reads "0 attached
                  to 2 customers" — every order landed on someone, they were just
                  created by this same run. */}
              {result.create} orders added ·{" "}
              {result.attachedToCustomers + result.attachedToNewCustomers} attached to{" "}
              {result.customersTouched} customers · {money(result.revenueCents)} in sales.
            </p>
            {result.newCustomers > 0 && (
              <p className="text-sm text-muted-foreground">
                {result.newCustomers} customer{result.newCustomers === 1 ? " was" : "s were"}{" "}
                added from these receipts, opted out of every channel.
              </p>
            )}
            {result.skipAlreadyImported > 0 && (
              <p className="text-sm text-muted-foreground">
                {result.skipAlreadyImported} were already imported and were left alone.
              </p>
            )}
            {warning && (
              <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
                {warning}
              </p>
            )}
          </div>

          {stages && (
            <div className="rounded-xl border border-border bg-card p-6">
              <h2 className="font-semibold text-sm">Where your customers stand now</h2>
              <p className="text-xs text-muted-foreground mt-1">
                Counted from what is in the database, not projected from the file.
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mt-4">
                {JOURNEY_ORDER.map((s) => (
                  <div key={s} className="rounded-xl border border-border px-4 py-3">
                    <p className="text-xs text-muted-foreground">{JOURNEY_LABELS[s]}</p>
                    <p className="text-xl font-semibold tabular-nums">{stages[s]}</p>
                  </div>
                ))}
              </div>
              {stages.new > 0 && (
                <p className="text-xs text-muted-foreground mt-3">
                  {stages.new} are still &ldquo;New&rdquo; — those are customers with no
                  completed orders in the system yet.
                </p>
              )}
            </div>
          )}

          <div className="flex gap-3">
            <Link
              href="/dashboard"
              className="text-sm bg-primary text-primary-foreground rounded-lg px-4 py-2 hover:bg-primary/90"
            >
              See your customers
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

// Everything the preview needs to say that isn't a headline number. Each of
// these is a reason an import can look fine and be wrong, so they're stated
// rather than left for the user to work out from the totals.
function PreviewNotes({
  summary,
  policy,
  createCustomers,
}: {
  summary: OrderImportSummary;
  policy: UnmatchedPolicy;
  createCustomers: boolean;
}) {
  const notes: { tone: "warn" | "plain"; body: React.ReactNode }[] = [];
  const s = (n: number) => (n === 1 ? "" : "s");

  // Stated before anything else when it applies: this is the one step of the
  // import that adds people to the CRM, and consent is the thing a café is
  // legally on the hook for.
  if (createCustomers && summary.newCustomers > 0)
    notes.push({
      tone: "plain",
      body: (
        <>
          <strong>
            {summary.newCustomers} new customer{s(summary.newCustomers)} will be added
          </strong>
          , every one of them opted out of WhatsApp, email and SMS. A receipt shows
          someone bought something, not that they agreed to be messaged — you can&apos;t
          bulk-opt-in from an import. Their member-since date is their first order in this
          file, not today.
        </>
      ),
    });

  if (createCustomers && summary.skipAmbiguousIdentity > 0)
    notes.push({
      tone: "warn",
      body: (
        <>
          <strong>
            {summary.skipAmbiguousIdentity} receipt{s(summary.skipAmbiguousIdentity)}{" "}
            share a phone or email with a different person
          </strong>{" "}
          in the same file — a shared handset, a counter typo or a recycled number.
          Creating a customer from them would invent a duplicate, so they&apos;re left out.
        </>
      ),
    });

  if (createCustomers && summary.skipNoNameToCreate > 0)
    notes.push({
      tone: "plain",
      body: (
        <>
          {summary.skipNoNameToCreate} receipt{s(summary.skipNoNameToCreate)} ha
          {summary.skipNoNameToCreate === 1 ? "s" : "ve"} a phone or email but no name, so
          there&apos;s nobody to create — a customer record with no name is unusable in
          every list. They&apos;re left out.
        </>
      ),
    });

  if (summary.create > 0 && summary.attachedToCustomers === 0 && !createCustomers)
    notes.push({
      tone: "warn",
      body: (
        <>
          <strong>None of these orders matched a customer.</strong> They&apos;d add to your
          sales totals but no one&apos;s history, spend or lifecycle stage would change.
          Check that the email and phone columns are mapped, and that these customers are
          already imported.
        </>
      ),
    });

  if (summary.conflicts > 0)
    notes.push({
      tone: "warn",
      body: (
        <>
          <strong>{summary.conflicts} receipts name two different customers</strong> — the
          email belongs to one person and the phone to another. Attaching the sale to
          either one would move the wrong customer&apos;s last visit, so these are left
          out. If they&apos;re the same person on file twice,{" "}
          <Link href="/dashboard/customers/merge" className="underline">
            merge the two records
          </Link>{" "}
          and import again — each one below links straight to it.
        </>
      ),
    });

  const unmatched = summary.skipNoCustomerMatch + summary.skipWalkIn;
  if (unmatched > 0 && policy === "skip")
    notes.push({
      tone: "plain",
      body: (
        <>
          {summary.skipWalkIn} walk-in receipts with no customer on them and{" "}
          {summary.skipNoCustomerMatch} for people not in your customer list will be left
          out. Switch the setting on the previous step to bring them in as walk-in sales.
        </>
      ),
    });

  if (summary.skipAlreadyImported > 0)
    notes.push({
      tone: "plain",
      body: (
        <>
          {summary.skipAlreadyImported} receipts are already in rice-mice and will be
          skipped, so re-importing this file won&apos;t double anything.
        </>
      ),
    });

  if (summary.skipDuplicateInFile > 0)
    notes.push({
      tone: "plain",
      body: (
        <>
          {summary.skipDuplicateInFile} rows are identical to another row in the same file
          — same customer, time, total and item — so they&apos;re treated as a duplicated
          export line and counted once.
        </>
      ),
    });

  if (summary.generatedRefs > 0)
    notes.push({
      tone: "plain",
      body: (
        <>
          {summary.generatedRefs} receipts have no order number in the file, so we
          identify them by customer, time and total. If your POS can export an order
          number, using it makes re-imports safer.
        </>
      ),
    });

  if (summary.unknownStatuses.length > 0)
    notes.push({
      tone: "warn",
      body: (
        <>
          <strong>Unrecognised status values</strong> —{" "}
          {summary.unknownStatuses.map((s) => `"${s}"`).join(", ")}. These are being
          counted as completed sales. If any of them mean refunded or voided, they&apos;ll
          inflate your totals.
        </>
      ),
    });

  if (summary.cancelled > 0)
    notes.push({
      tone: "plain",
      body: (
        <>
          {summary.cancelled} refunded or voided receipts will be recorded as cancelled —
          kept as history, but not counted as spend.
        </>
      ),
    });

  if (summary.rowErrors > 0)
    notes.push({
      tone: "warn",
      body: (
        <>
          <strong>{summary.rowErrors} rows can&apos;t be read</strong> and will be left
          out — see the list below.
        </>
      ),
    });

  if (summary.unmatchedItems.length > 0)
    notes.push({
      tone: "plain",
      body: (
        <>
          {summary.unmatchedItems.length} item names aren&apos;t on your menu (
          {summary.unmatchedItems.slice(0, 4).join(", ")}
          {summary.unmatchedItems.length > 4 ? ", …" : ""}). They&apos;re kept as written,
          so &ldquo;ever bought&rdquo; and favourite-item still work — nothing is added to
          your menu.
        </>
      ),
    });

  if (notes.length === 0) return null;

  return (
    <div className="space-y-3">
      {notes.map((n, i) => (
        <div
          key={i}
          className={`rounded-xl border p-4 text-sm ${
            n.tone === "warn"
              ? "border-amber-500/40 bg-amber-500/10"
              : "border-border bg-card text-muted-foreground"
          }`}
        >
          {n.body}
        </div>
      ))}
    </div>
  );
}

function OrderFormatGuide() {
  const rows: [string, React.ReactNode][] = [
    [
      "Columns matched for you",
      <>
        Receipt / order number, Date, Time, Customer email, Customer phone, Item, Quantity,
        Unit price, Line total, Discount, Order total, Payment method, Status, Staff.{" "}
        <span className="text-foreground">
          Anything else is ignored — an order has nowhere to put an extra column.
        </span>
      </>,
    ],
    [
      "One row per item",
      <>
        Rows that share a receipt number become one order with several lines. If your file
        has no receipt number, rows with the same customer and the same time are grouped
        instead.
      </>,
    ],
    [
      "Matching to customers",
      <>
        By phone, then email, against customers you already have.{" "}
        <span className="text-foreground">No new customers are created</span> — import
        your customer list first. A receipt whose email and phone point at two different
        people is reported, never guessed.
      </>,
    ],
    [
      "Money",
      <>
        <Code>8.50</Code>, <Code>$8.50</Code>, <Code>1,234.50</Code> and{" "}
        <Code>1.234,50</Code> all work. Line total is used when you have it, otherwise
        quantity × unit price − discount. Negative amounts are refund lines and are left
        out.
      </>,
    ],
    [
      "Status",
      <>
        <Code>completed</Code> <Code>paid</Code> <Code>closed</Code> count as sales;{" "}
        <Code>refunded</Code> <Code>voided</Code> <Code>cancelled</Code> are kept as
        history but not counted. No status column means everything counts.
      </>,
    ],
    [
      "Re-importing",
      <>
        Safe. Receipts already imported are skipped by their order number, so running the
        same file twice adds nothing.
      </>,
    ],
    [
      "The file itself",
      <>
        Comma, semicolon or tab separated. Up to 20,000 rows at a time — that&apos;s
        roughly 8,000 receipts.
      </>,
    ],
  ];

  return (
    <div className="rounded-xl border border-border bg-card p-6">
      <h2 className="font-semibold text-sm">What your file can look like</h2>
      <dl className="mt-3 space-y-3">
        {rows.map(([term, detail]) => (
          <div key={term} className="grid sm:grid-cols-[11rem_1fr] gap-x-4 gap-y-0.5">
            <dt className="text-sm font-medium">{term}</dt>
            <dd className="text-sm text-muted-foreground">{detail}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded bg-muted px-1 py-0.5 text-[0.8em] text-foreground">
      {children}
    </code>
  );
}

function Steps({ step }: { step: Step }) {
  const labels: [Step, string][] = [
    ["upload", "Choose file"],
    ["map", "Match columns"],
    ["preview", "Review"],
    ["done", "Done"],
  ];
  const activeIndex = labels.findIndex(([s]) => s === step);
  return (
    <ol className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
      {labels.map(([s, label], i) => (
        <li
          key={s}
          className={
            i === activeIndex
              ? "font-medium text-foreground"
              : i < activeIndex
                ? "text-muted-foreground"
                : "text-muted-foreground/50"
          }
        >
          {i + 1}. {label}
        </li>
      ))}
    </ol>
  );
}

function Stat({
  label,
  value,
  prefix,
}: {
  label: string;
  value: number | string;
  prefix?: boolean;
}) {
  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-xl font-semibold tabular-nums">
        {prefix && <span className="text-sm text-muted-foreground mr-0.5">$</span>}
        {value}
      </p>
    </div>
  );
}

function PreviewOrders({
  resolved,
}: {
  resolved: ReturnType<typeof resolveOrders>["resolved"];
}) {
  const conflicts = resolved.filter((r) => r.outcome.kind === "conflict").slice(0, 10);
  const landing = resolved.filter((r) => r.outcome.kind === "create").slice(0, 10);

  return (
    <div className="space-y-4">
      {conflicts.length > 0 && (
        <div className="rounded-xl border border-destructive/40 bg-card overflow-hidden">
          <p className="px-4 py-2.5 text-sm font-medium border-b border-border bg-destructive/10">
            Receipts naming two different customers
          </p>
          <ul className="divide-y divide-border/60">
            {conflicts.map(({ order, outcome }) => (
              <li
                key={order.importRef}
                className="px-4 py-2 text-sm flex flex-wrap items-baseline justify-between gap-2"
              >
                <span>
                  <span className="text-muted-foreground">
                    Line{order.rowNumbers.length > 1 ? "s" : ""}{" "}
                    {order.rowNumbers.join(", ")}:
                  </span>{" "}
                  {order.email} vs {order.phone}
                </span>
                {outcome.kind === "conflict" && (
                  // Straight to the merge screen with both records already
                  // chosen — this is the only fix, and hunting for the two
                  // people by hand is how a user gives up on the import.
                  <Link
                    href={`/dashboard/customers/merge?a=${outcome.emailCustomerId}&b=${outcome.phoneCustomerId}`}
                    className="text-xs underline text-muted-foreground hover:text-foreground whitespace-nowrap"
                  >
                    Are these one person?
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {landing.length > 0 && (
        <div className="rounded-xl border border-border bg-card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left border-b border-border bg-muted text-muted-foreground">
                <th className="px-4 py-2.5 font-medium">Receipt</th>
                <th className="px-4 py-2.5 font-medium">When</th>
                <th className="px-4 py-2.5 font-medium">Customer</th>
                <th className="px-4 py-2.5 font-medium">Items</th>
                <th className="px-4 py-2.5 font-medium text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {landing.map(({ order, outcome }) => (
                <tr key={order.importRef} className="border-b border-border/60 last:border-0">
                  <td className="px-4 py-2.5 font-mono text-xs">
                    {order.generatedRef ? "—" : order.importRef}
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground whitespace-nowrap">
                    {new Date(order.at).toLocaleString()}
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground truncate max-w-[14rem]">
                    {outcome.kind === "create" && outcome.newCustomerKey
                      ? `${order.firstName} ${order.lastName}`.trim() || "New customer"
                      : outcome.kind === "create" && !outcome.customerId
                        ? "Walk-in"
                        : (order.email ?? order.phone ?? "—")}
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground truncate max-w-[16rem]">
                    {order.lines.map((l) => `${l.quantity}× ${l.itemName}`).join(", ") || "—"}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    {money(order.totalCents)}
                    {order.status === "cancelled" && (
                      <span className="ml-2 text-xs text-muted-foreground">cancelled</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
