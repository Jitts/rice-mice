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
import { downloadText } from "@/lib/segmentExport";
import type { CustomFieldValueType } from "@/lib/segments";

type Step = "upload" | "map" | "preview" | "done";

// One fully-filled row and one sparse row, so the template shows both that
// every column is optional and what a populated record looks like.
const TEMPLATE_CSV = [
  "First Name,Last Name,Phone,Email,WhatsApp Opt-In,Email Opt-In,SMS Opt-In,Birthday,Signed Up,Tags,Notes",
  "Amara,Osei,+65 9123 4567,amara@example.com,yes,yes,no,1990-04-16,2021-03-02,regular | weekend,Prefers oat milk",
  "Sipho,Dlamini,91234568,,no,,,,2023-11-20,student,",
].join("\r\n");

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
  const [fileSize, setFileSize] = useState(0);
  const [csvText, setCsvText] = useState("");
  const [table, setTable] = useState<CsvTable | null>(null);
  const [mappings, setMappings] = useState<ColumnMapping[]>([]);
  const [policy, setPolicy] = useState<MatchPolicy>("skip");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportSummary | null>(null);

  // Clears the file AND everything derived from it. Keeping a stale mapping
  // across a file swap is the way you'd import the wrong columns without
  // noticing, so this resets rather than just changing step.
  function reset() {
    setStep("upload");
    setFilename("");
    setFileSize(0);
    setCsvText("");
    setTable(null);
    setMappings([]);
    setError(null);
    setResult(null);
  }

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
    setFileSize(file.size);
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

      {/* Which file is being acted on, kept on screen from mapping through to
          the result — the mapping and preview numbers are meaningless if you
          can't tell which file produced them. */}
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
              You&apos;ll match up the columns and see exactly what will happen before
              anything is saved.{" "}
              <button
                type="button"
                onClick={() => downloadText("rice-mice-customer-template.csv", TEMPLATE_CSV)}
                className="underline hover:text-foreground"
              >
                Download a template
              </button>
            </p>
          </div>

          <FormatGuide />
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

          {/* No "Back" here — the file bar's "Choose a different file" is the
              only way back from mapping, and it says what it actually does. */}
          <div className="flex justify-end">
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

// What the parser actually accepts, stated before the user picks a file —
// cheaper to read a format up front than to discover it in an error list.
// These strings mirror lib/customerImport.ts; if the parser widens, so does this.
function FormatGuide() {
  const rows: [string, React.ReactNode][] = [
    [
      "Columns matched for you",
      <>
        Name (or First / Last name), Phone (or Mobile), Email, WhatsApp / Email / SMS
        opt-in, Birthday, Signed up (or Member since), Tags, Notes.{" "}
        <span className="text-foreground">
          Every other column can become a custom field you can build segments on.
        </span>
      </>,
    ],
    [
      "Opt-in columns",
      <>
        Counts as opted in: <Code>yes</Code> <Code>y</Code> <Code>true</Code>{" "}
        <Code>1</Code> <Code>subscribed</Code> <Code>opted in</Code>. Anything else —
        including blank, <Code>maybe</Code> and <Code>1.0</Code> — imports as{" "}
        <span className="text-foreground">not opted in</span>, and that person can&apos;t
        be messaged until they opt in. No column at all means nobody is opted in.
      </>,
    ],
    [
      "Dates",
      <>
        <Code>2024-03-15</Code>, <Code>15/03/2024</Code>, <Code>03/15/2024</Code> or{" "}
        <Code>15 Mar 2024</Code>. Day-first and month-first look identical, so you
        confirm which one on the next step.
      </>,
    ],
    [
      "Phone numbers",
      <>
        Any formatting — <Code>+65 9123 4567</Code> and <Code>91234568</Code> both work.
        Needs 8–15 digits. This is also how we spot someone you already have.
      </>,
    ],
    [
      "Tags",
      <>
        One cell, separated by <Code>|</Code> <Code>,</Code> or <Code>;</Code> — e.g.{" "}
        <Code>regular | weekend</Code>.
      </>,
    ],
    [
      "The file itself",
      <>
        Comma, semicolon or tab separated. Excel exports work as-is, including quoted
        cells and accented or non-Latin characters. Up to 5,000 rows at a time.
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
