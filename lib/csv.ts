// RFC 4180 CSV reader — the read side of the quoting rules `profilesToCsv`
// already writes (lib/segmentExport.ts). Written as a character scanner rather
// than a line-split because a quoted cell may legally contain commas, newlines
// and escaped quotes, and real café exports (Excel, Square, Loyverse) all
// produce them. Pure: no I/O, importable from the browser and from tests.

export type CsvTable = {
  headers: string[];
  rows: string[][];
};

const BOM = "\uFEFF";

// Excel writes a UTF-8 BOM; left in place it becomes part of the first header
// name and silently breaks header matching.
function stripBom(input: string): string {
  return input.startsWith(BOM) ? input.slice(1) : input;
}

// Delimiter varies by locale — a European Excel export is usually
// semicolon-separated, and exports pasted from a spreadsheet are often tabs.
// Counts candidates in the header line only, ignoring anything inside quotes.
export function sniffDelimiter(input: string): string {
  const firstLine = stripBom(input).split(/\r?\n/, 1)[0] ?? "";
  let best = ",";
  let bestCount = 0;
  for (const candidate of [",", ";", "\t", "|"]) {
    let count = 0;
    let inQuotes = false;
    for (const ch of firstLine) {
      if (ch === '"') inQuotes = !inQuotes;
      else if (!inQuotes && ch === candidate) count++;
    }
    if (count > bestCount) {
      bestCount = count;
      best = candidate;
    }
  }
  return best;
}

export function parseCsv(input: string, delimiter?: string): CsvTable {
  const text = stripBom(input);
  const delim = delimiter ?? sniffDelimiter(input);

  const records: string[][] = [];
  let record: string[] = [];
  let cell = "";
  let inQuotes = false;
  let i = 0;

  const endCell = () => {
    record.push(cell);
    cell = "";
  };
  const endRecord = () => {
    endCell();
    records.push(record);
    record = [];
  };

  while (i < text.length) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        // "" inside a quoted cell is one literal quote.
        if (text[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      cell += ch;
      i++;
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === delim) {
      endCell();
      i++;
      continue;
    }
    if (ch === "\r") {
      if (text[i + 1] === "\n") i++; // CRLF
      endRecord();
      i++;
      continue;
    }
    if (ch === "\n") {
      endRecord();
      i++;
      continue;
    }
    cell += ch;
    i++;
  }
  // Trailing record, unless the file ended exactly on a line break.
  if (cell !== "" || record.length > 0) endRecord();

  if (records.length === 0) return { headers: [], rows: [] };

  const headers = (records.shift() ?? []).map((h) => h.trim());
  const width = headers.length;
  const rows = records
    // Spreadsheets routinely leave blank lines at the end of a file.
    .filter((r) => r.some((c) => c.trim() !== ""))
    // Ragged rows: pad short ones and drop overflow, so every row is indexable
    // by header position without a length check at every call site.
    .map((r) => {
      const out = r.slice(0, width);
      while (out.length < width) out.push("");
      return out;
    });

  return { headers, rows };
}

// Values of one column, for type-guessing and date-format inference.
export function columnValues(table: CsvTable, index: number): string[] {
  return table.rows.map((r) => r[index] ?? "");
}
