"use client";

// Sprint 45: preview-then-commit customer import.
//
// The whole point of the four steps is that nothing is written until the user
// has seen the real counts — including how many people will arrive opted OUT,
// which is the number that decides whether the file was mapped correctly. The
// preview runs the same pure pipeline the server re-runs before writing
// (lib/customerImport.ts); this side is for the human, not for the database.

import { useMemo, useState } from "react";
import Link from "next/link";
import { parseCsv, columnValues, type CsvTable } from "@/lib/csv";
import {
  autoMapColumns,
  inferDateOrder,
  parseRows,
  resolveRows,
  summarize,
  BUILTIN_LABELS,
  guessValueType,
  type BuiltinTargetId,
  type ColumnMapping,
  type DateOrder,
  type ExistingCustomer,
  type ImportSummary,
  type MatchPolicy,
} from "@/lib/customerImport";
import { importCustomers } from "@/app/actions/customerImport";
import type { CustomFieldValueType } from "@/lib/segments";

type Step = "upload" | "map" | "preview" | "done";

const BUILTIN_IDS = Object.keys(BUILTIN_LABELS) as BuiltinTargetId[];

const VALUE_TYPES: CustomFieldValueType[] = ["text", "number", "boolean", "date"];

const selectClass =
  "rounded-lg border border-border bg-background px-2 py-1.5 text-sm";

function slugify(header: string): string {
  return (
    header
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 48) || "field"
  );
}

export function CustomerImportWizard({
  existingCustomers,
  existingCustomKeys,
}: {
  existingCustomers: ExistingCustomer[];
  existingCustomKeys: string[];
}) {
  const [step, setStep] = useState<Step>("upload");
  const [filename, setFilename] = useState("");
  const [csvText, setCsvText] = useState("");
  const [table, setTable] = useState<CsvTable | null>(null);
  const [mappings, setMappings] = useState<ColumnMapping[]>([]);
  const [policy, setPolicy] = useState<MatchPolicy>("skip");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportSummary | null>(null);

  // Recomputed on every mapping change so the preview always reflects the
  // choices currently on screen.
  const preview = useMemo(() => {
    if (!table || mappings.length === 0) return null;
    const rows = parseRows(table, mappings);
    const resolved = resolveRows(rows, existingCustomers, policy);
    return { resolved, summary: summarize(resolved, mappings) };
  }, [table, mappings, policy, existingCustomers]);

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
    setCsvText(text);
    setTable(parsed);
    setMappings(autoMapColumns(parsed, existingCustomKeys));
    setStep("map");
  }

  function setTarget(index: number, value: string) {
    setMappings((ms) =>
      ms.map((m) => {
        if (m.index !== index) return m;
        if (value === "ignore") return { header: m.header, index: m.index, target: { kind: "ignore" } };
        if (value === "custom") {
          const values = table ? columnValues(table, m.index) : [];
          const valueType = guessValueType(values);
          const next: ColumnMapping = {
            header: m.header,
            index: m.index,
            target: {
              kind: "custom",
              key: slugify(m.header),
              label: m.header.trim() || `Column ${m.index + 1}`,
              valueType,
            },
          };
          if (valueType === "date") next.dateOrder = inferDateOrder(values);
          return next;
        }
        const id = value.replace("builtin:", "") as BuiltinTargetId;
        const next: ColumnMapping = {
          header: m.header,
          index: m.index,
          target: { kind: "builtin", id },
        };
        if (id === "birthday" || id === "signed_up")
          next.dateOrder = table ? inferDateOrder(columnValues(table, m.index)) : "iso";
        return next;
      }),
    );
  }

  function setValueType(index: number, valueType: CustomFieldValueType) {
    setMappings((ms) =>
      ms.map((m) => {
        if (m.index !== index || m.target.kind !== "custom") return m;
        const next: ColumnMapping = {
          ...m,
          target: { ...m.target, valueType },
        };
        if (valueType === "date")
          next.dateOrder =
            m.dateOrder ?? (table ? inferDateOrder(columnValues(table, m.index)) : "iso");
        else delete next.dateOrder;
        return next;
      }),
    );
  }

  function setDateOrder(index: number, dateOrder: DateOrder) {
    setMappings((ms) => ms.map((m) => (m.index === index ? { ...m, dateOrder } : m)));
  }

  async function commit() {
    setBusy(true);
    setError(null);
    const res = await importCustomers({ filename, csvText, mappings, policy });
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setResult(res.summary);
    setStep("done");
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-bold tracking-tight">
            Import customers
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Nothing is saved until you review the preview.
          </p>
        </div>
        <Link href="/dashboard" className="text-sm text-muted-foreground hover:text-foreground">
          Cancel
        </Link>
      </div>

      <Steps step={step} />

      {error && (
        <p className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </p>
      )}

      {step === "upload" && (
        <div className="rounded-xl border border-border bg-card p-6 space-y-4">
          <div>
            <h2 className="font-semibold">Choose your customer list</h2>
            <p className="text-sm text-muted-foreground mt-1">
              A CSV export from your current system. Columns we recognise are matched
              automatically — anything else can become a custom field you can segment on.
            </p>
          </div>
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => void onFile(e.target.files?.[0] ?? null)}
            className="block w-full text-sm file:mr-4 file:rounded-lg file:border-0 file:bg-primary file:px-4 file:py-2 file:text-sm file:text-primary-foreground hover:file:bg-primary/90"
          />
          <p className="text-xs text-muted-foreground">
            Opt-in columns are read strictly: anyone whose file doesn&apos;t clearly say
            they agreed is imported as not opted in, and can&apos;t be messaged until they do.
          </p>
        </div>
      )}

      {step === "map" && table && (
        <div className="space-y-4">
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
                    m.target.kind === "builtin"
                      ? `builtin:${m.target.id}`
                      : m.target.kind;
                  return (
                    <tr key={m.index} className="border-b border-border/60 last:border-0">
                      <td className="px-4 py-2.5 font-medium">{m.header || `Column ${m.index + 1}`}</td>
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
                            {BUILTIN_IDS.map((id) => (
                              <option key={id} value={`builtin:${id}`}>
                                {BUILTIN_LABELS[id]}
                              </option>
                            ))}
                            <option value="custom">New custom field</option>
                            <option value="ignore">Don&apos;t import</option>
                          </select>

                          {m.target.kind === "custom" && (
                            <>
                              <select
                                value={m.target.valueType}
                                onChange={(e) =>
                                  setValueType(m.index, e.target.value as CustomFieldValueType)
                                }
                                className={selectClass}
                              >
                                {VALUE_TYPES.map((t) => (
                                  <option key={t} value={t}>
                                    {t}
                                  </option>
                                ))}
                              </select>
                              <span className="text-xs text-muted-foreground">
                                segmentable
                              </span>
                            </>
                          )}

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

          <fieldset className="rounded-xl border border-border bg-card p-4">
            <legend className="px-1 text-sm font-medium">
              When a row matches a customer you already have
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
                  Skip the row
                  <span className="block text-xs text-muted-foreground">
                    Leaves everything you already have untouched.
                  </span>
                </span>
              </label>
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="radio"
                  checked={policy === "update"}
                  onChange={() => setPolicy("update")}
                  className="mt-1"
                />
                <span>
                  Fill in their details from the file
                  <span className="block text-xs text-muted-foreground">
                    Only adds or overwrites values the file actually has. An existing
                    opt-in is never removed by an import.
                  </span>
                </span>
              </label>
            </div>
          </fieldset>

          <div className="flex justify-between">
            <button
              type="button"
              onClick={() => setStep("upload")}
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              Back
            </button>
            <button
              type="button"
              onClick={() => setStep("preview")}
              className="text-sm bg-primary text-primary-foreground rounded-lg px-4 py-2 hover:bg-primary/90"
            >
              Preview import
            </button>
          </div>
        </div>
      )}

      {step === "preview" && preview && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Stat label="Will be added" value={preview.summary.create} />
            <Stat label="Will be updated" value={preview.summary.update} />
            <Stat label="Skipped as duplicates" value={preview.summary.skip} />
            <Stat label="Rows with problems" value={preview.summary.error} />
          </div>

          <div
            className={`rounded-xl border p-4 text-sm ${
              preview.summary.consentColumnsMapped
                ? "border-border bg-card"
                : "border-amber-500/40 bg-amber-500/10"
            }`}
          >
            <p className="font-medium">
              {preview.summary.optedIn} opted in · {preview.summary.notOptedIn} not opted in
            </p>
            <p className="text-muted-foreground mt-1">
              {preview.summary.consentColumnsMapped
                ? "Only rows whose file clearly says the customer agreed are opted in. Everyone else imports as not opted in and can't be messaged until they opt in."
                : "No opt-in column was mapped, so everyone will import as not opted in and can't be included in a campaign. If your file has a consent column, go back and map it."}
            </p>
          </div>

          {preview.summary.newCustomFields.length > 0 && (
            <div className="rounded-xl border border-border bg-card p-4 text-sm">
              <p className="font-medium">
                {preview.summary.newCustomFields.length} new custom field
                {preview.summary.newCustomFields.length === 1 ? "" : "s"} will be created
              </p>
              <p className="text-muted-foreground mt-1">
                {preview.summary.newCustomFields.map((f) => `${f.label} (${f.valueType})`).join(", ")}
                {" — "}available as segment criteria straight after the import.
              </p>
            </div>
          )}

          <PreviewRows resolved={preview.resolved} />

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
              disabled={busy || preview.summary.create + preview.summary.update === 0}
              onClick={() => void commit()}
              className="text-sm bg-primary text-primary-foreground rounded-lg px-4 py-2 hover:bg-primary/90 disabled:opacity-50"
            >
              {busy
                ? "Importing…"
                : `Import ${preview.summary.create + preview.summary.update} customers`}
            </button>
          </div>
        </div>
      )}

      {step === "done" && result && (
        <div className="rounded-xl border border-border bg-card p-6 space-y-3">
          <h2 className="font-semibold">Import finished</h2>
          <p className="text-sm text-muted-foreground">
            {result.create} added · {result.update} updated · {result.skip} skipped ·{" "}
            {result.error} with problems. {result.notOptedIn} arrived not opted in.
          </p>
          <p className="text-sm text-muted-foreground">
            Imported customers have no purchase history yet, so they all sit in the
            &ldquo;New&rdquo; stage until you import their orders.
          </p>
          <div className="flex gap-3 pt-1">
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

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function PreviewRows({
  resolved,
}: {
  resolved: ReturnType<typeof resolveRows>;
}) {
  // Problems first — they're the reason to go back and fix the file.
  const problems = resolved.filter((r) => r.outcome.kind === "error").slice(0, 10);
  const landing = resolved
    .filter((r) => r.outcome.kind === "create" || r.outcome.kind === "update")
    .slice(0, 10);

  return (
    <div className="space-y-4">
      {problems.length > 0 && (
        <div className="rounded-xl border border-destructive/40 bg-card overflow-hidden">
          <p className="px-4 py-2.5 text-sm font-medium border-b border-border bg-destructive/10">
            Rows that won&apos;t be imported
          </p>
          <ul className="divide-y divide-border/60">
            {problems.map(({ row, outcome }) => (
              <li key={row.rowNumber} className="px-4 py-2 text-sm">
                <span className="text-muted-foreground">Line {row.rowNumber}:</span>{" "}
                {outcome.kind === "error" ? outcome.errors.join("; ") : null}
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
                <th className="px-4 py-2.5 font-medium">Name</th>
                <th className="px-4 py-2.5 font-medium">Phone</th>
                <th className="px-4 py-2.5 font-medium">Email</th>
                <th className="px-4 py-2.5 font-medium">Opted in</th>
                <th className="px-4 py-2.5 font-medium">Signed up</th>
              </tr>
            </thead>
            <tbody>
              {landing.map(({ row }) => {
                const channels = [
                  row.whatsappOptIn && "WhatsApp",
                  row.emailOptIn && "Email",
                  row.smsOptIn && "SMS",
                ].filter(Boolean) as string[];
                return (
                  <tr key={row.rowNumber} className="border-b border-border/60 last:border-0">
                    <td className="px-4 py-2.5">
                      {[row.firstName, row.lastName].filter(Boolean).join(" ") || "—"}
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">{row.phone ?? "—"}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{row.email ?? "—"}</td>
                    <td className="px-4 py-2.5">
                      {channels.length > 0 ? (
                        channels.join(", ")
                      ) : (
                        <span className="text-muted-foreground">No</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">
                      {row.signedUpAt ?? "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
