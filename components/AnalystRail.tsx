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
  const [mobileOpen, setMobileOpen] = useState(false);

  const panelWidth = isDesktop && available > 0 ? clampWidth(width, available) : undefined;

  // Sprint 58. Below lg the rail used to STACK below the page content, so
  // asking the assistant meant scrolling past the whole report to reach it —
  // on the surface where scrolling costs the most. On mobile it is now a
  // floating button that opens the same panel as a sheet.
  //
  // One instance, not two: the same <section> is repositioned by class, so the
  // conversation is not duplicated and does not reset when the viewport
  // crosses the breakpoint.
  const shown = isDesktop ? open : mobileOpen;

  // Escape closes the mobile sheet — it covers the page, so there has to be a
  // way out that is not the one button.
  useEffect(() => {
    if (!mobileOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setMobileOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mobileOpen]);

  return (
    // items-start, not items-stretch: the rail sizes itself (via the sticky +
    // max-height below) instead of being force-matched to the content
    // column's full height — that stretch was why it used to scroll away
    // with the page, exactly what "static like the nav" is fixing.
    <div ref={rowRef} className="flex flex-col lg:flex-row lg:items-start gap-6 lg:gap-0">
      <div className="flex-1 min-w-0 lg:pr-6">{children}</div>

      {/* Collapsed strip — desktop only. Sticky + fixed height, same trick as
          the panel below, so it stays a full-looking bar instead of
          collapsing to the height of its own (short) label content. */}
      {isDesktop && !open && (
        <button
          onClick={() => toggle(true)}
          aria-expanded={false}
          title={`${title} — click to open`}
          className="lg:sticky lg:top-8 lg:h-[calc(100vh-4rem)] w-9 shrink-0 border-l border-border bg-card hover:bg-muted flex flex-col items-center gap-2 py-3 text-muted-foreground hover:text-foreground transition-colors"
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

      {shown && (
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
              className={`lg:sticky lg:top-8 lg:h-[calc(100vh-4rem)] w-1.5 shrink-0 cursor-col-resize border-l border-border hover:bg-primary/30 focus-visible:bg-primary/40 focus-visible:outline-none ${
                dragging ? "bg-primary/40" : ""
              }`}
            />
          )}
          {/* Sticky + a FIXED height (not min/max) is what makes this "static
              like the left nav": the card always spans top-8 to a matching
              32px margin at the bottom, same as the strip and handle beside
              it, rather than shrinking to fit an empty conversation and
              leaving a gap below. */}
          <section
            aria-label={title}
            style={panelWidth ? { width: panelWidth } : undefined}
            className={`shrink-0 border border-border bg-card flex flex-col lg:border-l-0 lg:sticky lg:top-8 lg:h-[calc(100vh-4rem)] ${
              isDesktop
                ? ""
                : "fixed inset-x-0 bottom-0 top-16 z-50 rounded-t-xl shadow-lg"
            }`}
          >
            <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-border">
              <h2 className="font-heading text-sm font-semibold">{title}</h2>
              <button
                onClick={() => (isDesktop ? toggle(false) : setMobileOpen(false))}
                aria-expanded
                aria-label={isDesktop ? `Collapse ${title}` : `Close ${title}`}
                className="text-muted-foreground hover:text-foreground"
              >
                {isDesktop ? (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M9 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                ) : (
                  // A chevron means "collapse sideways", which is not what
                  // closing a full-screen sheet does.
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
                  </svg>
                )}
              </button>
            </div>
            <div className="flex-1 min-h-0 flex flex-col">{panel}</div>
          </section>
        </>
      )}

      {/* Backdrop. Tapping outside is how a sheet is dismissed on a phone; the
          panel sits above it at z-50. */}
      {!isDesktop && mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40"
          onClick={() => setMobileOpen(false)}
          aria-hidden
        />
      )}

      {/* The floating button. Round because a FAB reads as one, which is the
          one place this system's sharp-corner rule is worth spending — it has
          to be unmistakably a control floating over content rather than a card
          stuck to it. Hidden while the sheet is open so it never covers the
          conversation it just opened. */}
      {!isDesktop && !mobileOpen && (
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          aria-expanded={false}
          aria-label={`Open ${title}`}
          className="lg:hidden fixed bottom-5 right-5 z-40 size-14 rounded-full bg-primary text-primary-foreground shadow-lg flex items-center justify-center active:translate-y-px hover:bg-primary/90"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <path d="M8 9h8M8 13h5" strokeLinecap="round" />
            <path d="M21 12a8 8 0 0 1-8 8H7l-4 3V12a8 8 0 0 1 8-8h2a8 8 0 0 1 8 8z" strokeLinejoin="round" />
          </svg>
        </button>
      )}
    </div>
  );
}
