"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { glossaryById } from "@/lib/glossary";
import { useLoyalty, useRules } from "@/components/RulesContext";

// A small ⓘ next to a metric label. Tap to open the definition (hover-only
// tooltips don't work on the counter iPad), tap outside or Esc to close.
export function InfoTip({
  term,
  align = "center",
}: {
  term: string;
  align?: "left" | "center" | "right";
}) {
  const rules = useRules();
  const loyalty = useLoyalty();
  const def = useMemo(
    () => glossaryById(rules, loyalty)[term],
    [rules, loyalty, term],
  );
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!def) return null;

  const alignClass =
    align === "right"
      ? "right-0"
      : align === "left"
        ? "left-0"
        : "left-1/2 -translate-x-1/2";

  return (
    <span ref={ref} className="relative inline-block align-middle">
      <button
        type="button"
        aria-label={`What does “${def.term}” mean?`}
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        className="ml-1 inline-flex h-4 w-4 items-center justify-center rounded-full border border-input text-[10px] font-serif italic leading-none text-muted-foreground/70 hover:border-ring hover:text-foreground/80"
      >
        i
      </button>
      {open && (
        <span
          role="tooltip"
          className={`absolute top-full z-30 mt-1.5 block w-64 rounded-lg border border-border bg-card p-3 text-left font-normal normal-case tracking-normal whitespace-normal shadow-lg ${alignClass}`}
        >
          <span className="block text-xs font-semibold text-foreground">
            {def.term}
          </span>
          <span className="mt-1 block text-xs text-muted-foreground">{def.short}</span>
          <span className="mt-1 block text-[11px] leading-snug text-muted-foreground/70">
            {def.how}
          </span>
          <Link
            href="/dashboard/glossary"
            onClick={() => setOpen(false)}
            className="mt-1.5 block text-[11px] text-blue-600 dark:text-blue-400 hover:underline"
          >
            Full glossary →
          </Link>
        </span>
      )}
    </span>
  );
}
