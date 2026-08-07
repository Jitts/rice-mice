"use client";

// Pagination for the dashboard's long tables. A café that imports its existing
// customer list jumps from a handful of rows to hundreds in one click, which
// turns a scannable table into an endless page — so the tables that can grow
// without bound page by default rather than as a later fix.

import { useMemo, useState } from "react";

export const PAGE_SIZES = [10, 25, 50, 100];

export type Pager<T> = {
  visible: T[];
  page: number;
  pageCount: number;
  pageSize: number;
  from: number;
  to: number;
  total: number;
  setPage: (n: number) => void;
  setPageSize: (n: number) => void;
};

export function usePager<T>(rows: T[], defaultSize = 25): Pager<T> {
  const [pageSize, setSize] = useState(defaultSize);
  const [page, setPage] = useState(1);

  return useMemo(() => {
    const total = rows.length;
    const pageCount = Math.max(1, Math.ceil(total / pageSize));
    // Clamp rather than store: the row count can shrink underneath us (a tag
    // edit re-filters, a row is deleted), and a page that no longer exists
    // would otherwise render empty with no way back.
    const current = Math.min(Math.max(1, page), pageCount);
    const start = (current - 1) * pageSize;
    return {
      visible: rows.slice(start, start + pageSize),
      page: current,
      pageCount,
      pageSize,
      from: total === 0 ? 0 : start + 1,
      to: Math.min(start + pageSize, total),
      total,
      setPage,
      setPageSize: (n: number) => {
        setSize(n);
        setPage(1); // a new page size makes the old page number meaningless
      },
    };
  }, [rows, page, pageSize]);
}

// 1 … 4 5 [6] 7 8 … 20 — always shows the first and last page so the ends of
// the list stay one click away however long it is.
function pageWindow(page: number, pageCount: number): (number | "gap")[] {
  if (pageCount <= 7)
    return Array.from({ length: pageCount }, (_, i) => i + 1);
  const out: (number | "gap")[] = [1];
  const lo = Math.max(2, page - 1);
  const hi = Math.min(pageCount - 1, page + 1);
  if (lo > 2) out.push("gap");
  for (let i = lo; i <= hi; i++) out.push(i);
  if (hi < pageCount - 1) out.push("gap");
  out.push(pageCount);
  return out;
}

const navButton =
  "min-w-8 rounded-lg px-2 py-1 text-sm hover:bg-muted disabled:opacity-40 disabled:hover:bg-transparent";

export function TablePager<T>({
  pager,
  noun = "rows",
}: {
  pager: Pager<T>;
  noun?: string;
}) {
  const { page, pageCount, pageSize, from, to, total, setPage, setPageSize } = pager;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-2.5">
      <p className="text-sm text-muted-foreground">
        Showing <span className="tabular-nums">{from.toLocaleString()}</span>–
        <span className="tabular-nums">{to.toLocaleString()}</span> of{" "}
        <span className="tabular-nums">{total.toLocaleString()}</span> {noun}
      </p>

      <div className="flex items-center gap-3">
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          Show
          <select
            value={pageSize}
            onChange={(e) => setPageSize(Number(e.target.value))}
            className="rounded-lg border border-border bg-background px-2 py-1 text-sm"
          >
            {PAGE_SIZES.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>

        {pageCount > 1 && (
          <nav className="flex items-center gap-0.5" aria-label={`${noun} pages`}>
            <button
              type="button"
              className={navButton}
              onClick={() => setPage(page - 1)}
              disabled={page === 1}
              aria-label="Previous page"
            >
              ‹
            </button>
            {pageWindow(page, pageCount).map((p, i) =>
              p === "gap" ? (
                <span key={`gap${i}`} className="px-1 text-muted-foreground/60">
                  …
                </span>
              ) : (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPage(p)}
                  aria-current={p === page ? "page" : undefined}
                  className={
                    p === page
                      ? `${navButton} bg-primary text-primary-foreground hover:bg-primary/90 tabular-nums`
                      : `${navButton} tabular-nums`
                  }
                >
                  {p}
                </button>
              ),
            )}
            <button
              type="button"
              className={navButton}
              onClick={() => setPage(page + 1)}
              disabled={page === pageCount}
              aria-label="Next page"
            >
              ›
            </button>
          </nav>
        )}
      </div>
    </div>
  );
}
