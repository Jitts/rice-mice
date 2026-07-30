"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// The right rail that holds the analyst on Reports. Collapsed it is a thin
// strip; clicking widens it into a panel the user can drag to any width they
// like, so it never has to cover the work it is describing.
//
// Deliberately scoped to Reports for now (Sprint 44) rather than lifted into
// the dashboard shell — the same pattern will suit the planner chats on
// Segments/Campaigns/Journeys, but it earns that move after it has been used
// here, not before.
//
// Below `lg` the whole thing degrades to a normal stacked block: no rail, no
// drag, always open. A 34px strip and a drag handle are pointless on a phone,
// and there is only ever ONE mounted child so the conversation survives a
// resize across that breakpoint.

const MIN_WIDTH = 300;
const MAX_WIDTH = 620;
const DEFAULT_WIDTH = 380;
const KEEP_FOR_CONTENT = 420; // never let the rail squeeze the page below this
const STORE_OPEN = "rice-mice.analystRail.open";
const STORE_WIDTH = "rice-mice.analystRail.width";

function clampWidth(px: number, available: number): number {
  const ceiling = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, available - KEEP_FOR_CONTENT));
  return Math.round(Math.min(ceiling, Math.max(MIN_WIDTH, px)));
}

export function AnalystRail({
  title,
  openSignal,
  panel,
  children,
}: {
  title: string;
  // Bumped by the parent when something outside should open the rail — "Ask
  // why" on a finding, for instance. A counter rather than a boolean so
  // repeated asks re-open it after the user has closed it.
  openSignal?: number;
  panel: React.ReactNode; // what lives in the rail
  children: React.ReactNode; // the page content beside it
}) {
  const [open, setOpen] = useState(false);
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const [isDesktop, setIsDesktop] = useState(false);
  const [dragging, setDragging] = useState(false);
  // Measured, not read off the ref during render: the clamp depends on how much
  // room the row actually has, and that changes when the window or the collapsed
  // sidebar changes. A ref read during render would be null on first paint and
  // would never update afterwards.
  const [available, setAvailable] = useState(0);
  const rowRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = rowRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setAvailable(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Read persisted state after mount — touching localStorage during render
  // would mismatch the server HTML.
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const sync = () => setIsDesktop(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    try {
      setOpen(window.localStorage.getItem(STORE_OPEN) === "1");
      const stored = Number(window.localStorage.getItem(STORE_WIDTH));
      if (Number.isFinite(stored) && stored > 0) setWidth(stored);
    } catch {
      // Private mode / storage disabled — defaults are fine.
    }
    return () => mq.removeEventListener("change", sync);
  }, []);

  const persist = useCallback((key: string, value: string) => {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      // Non-fatal: the rail just won't remember next visit.
    }
  }, []);

  function toggle(next: boolean) {
    setOpen(next);
    persist(STORE_OPEN, next ? "1" : "0");
  }

  useEffect(() => {
    if (openSignal && openSignal > 0) {
      setOpen(true);
      persist(STORE_OPEN, "1");
    }
  }, [openSignal, persist]);

  // Pointer drag. Dragging left widens, which is why the delta is inverted.
  useEffect(() => {
    if (!dragging) return;
    function onMove(e: PointerEvent) {
      const right = rowRef.current?.getBoundingClientRect().right ?? window.innerWidth;
      setWidth(clampWidth(right - e.clientX, available));
    }
    function onUp() {
      setDragging(false);
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [dragging, available]);

  useEffect(() => {
    if (!dragging) persist(STORE_WIDTH, String(width));
  }, [dragging, width, persist]);

  // The handle is a real separator: focusable, and the arrow keys resize it.
  // Drag-only would put the width out of reach for keyboard users.
  function onHandleKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      setWidth((w) => clampWidth(w + 24, available));
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      setWidth((w) => clampWidth(w - 24, available));
    }
  }

  // Re-clamped on every render against the measured row, so shrinking the
  // window pulls an over-wide panel back in rather than crushing the reports.
  const panelWidth = isDesktop && available > 0 ? clampWidth(width, available) : undefined;

  return (
    <div ref={rowRef} className="flex flex-col lg:flex-row lg:items-stretch gap-6 lg:gap-0">
      <div className="flex-1 min-w-0 lg:pr-6">{children}</div>

      {/* Collapsed strip — desktop only. */}
      {isDesktop && !open && (
        <button
          onClick={() => toggle(true)}
          aria-expanded={false}
          title={`${title} — click to open`}
          className="self-stretch w-9 shrink-0 border-l border-border bg-card hover:bg-muted flex flex-col items-center gap-2 py-3 text-muted-foreground hover:text-foreground transition-colors"
        >
          <span aria-hidden className="text-primary">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M8 9h8M8 13h5" strokeLinecap="round" />
              <path d="M21 12a8 8 0 0 1-8 8H7l-4 3V12a8 8 0 0 1 8-8h2a8 8 0 0 1 8 8z" strokeLinejoin="round" />
            </svg>
          </span>
          <span className="text-[10px] [writing-mode:vertical-rl] tracking-wide">{title}</span>
        </button>
      )}

      {(!isDesktop || open) && (
        <>
          {isDesktop && (
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize the analyst panel"
              tabIndex={0}
              onPointerDown={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onKeyDown={onHandleKey}
              className={`w-1.5 shrink-0 cursor-col-resize border-l border-border hover:bg-primary/30 focus-visible:bg-primary/40 focus-visible:outline-none ${
                dragging ? "bg-primary/40" : ""
              }`}
            />
          )}
          <section
            aria-label={title}
            style={panelWidth ? { width: panelWidth } : undefined}
            className="shrink-0 border border-border bg-card flex flex-col lg:border-l-0 lg:min-h-[32rem]"
          >
            <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-border">
              <h2 className="font-heading text-sm font-semibold">{title}</h2>
              {isDesktop && (
                <button
                  onClick={() => toggle(false)}
                  aria-expanded
                  aria-label={`Collapse ${title}`}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M9 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              )}
            </div>
            <div className="flex-1 min-h-0 flex flex-col">{panel}</div>
          </section>
        </>
      )}
    </div>
  );
}
