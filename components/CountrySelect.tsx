"use client";

// Sprint 57. The dialling-code picker behind both phone fields: the public
// sign-up form and the shop's own setting in Settings.
//
// Built on the radix Popover already in the project rather than adding
// intl-tel-input, which would put ~100KB plus flag sprites and a stylesheet on
// the PUBLIC page — the one that has to load on a customer's phone at a
// counter. Flags are emoji derived from the ISO code, so there are no images:
// real flags on iOS/Android/macOS, the two-letter code on Windows.

import { useEffect, useMemo, useRef, useState } from "react";
import { Popover } from "radix-ui";
import { COUNTRIES, flagOf, searchCountries, type Country } from "@/lib/countries";

export function CountrySelect({
  value,
  onChange,
  id,
  buttonClassName = "",
  ariaLabel = "Country dialling code",
  allowClear = false,
}: {
  /** ISO alpha-2, or null for "none chosen". */
  value: string | null;
  onChange: (country: Country | null) => void;
  id?: string;
  buttonClassName?: string;
  ariaLabel?: string;
  /** Settings allows "no hint"; the sign-up form always needs a country. */
  allowClear?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const selected = useMemo(
    () => COUNTRIES.find((c) => c.iso === value) ?? null,
    [value],
  );
  const results = useMemo(() => searchCountries(query), [query]);

  // Reopening with the previous search still in the box would hide most of the
  // list behind a filter the user has forgotten typing.
  useEffect(() => {
    if (open) setQuery("");
  }, [open]);

  function pick(c: Country | null) {
    onChange(c);
    setOpen(false);
  }

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          id={id}
          type="button"
          aria-label={
            selected ? `${ariaLabel}: ${selected.name} +${selected.dial}` : ariaLabel
          }
          className={`flex items-center gap-1.5 border border-input rounded px-2 h-[42px] text-sm bg-background hover:bg-muted shrink-0 ${buttonClassName}`}
        >
          {selected ? (
            <>
              <span aria-hidden className="text-base leading-none">
                {flagOf(selected.iso)}
              </span>
              <span className="tabular-nums">+{selected.dial}</span>
            </>
          ) : (
            <span className="text-muted-foreground">Country</span>
          )}
          <span aria-hidden className="text-muted-foreground text-[10px]">
            ▾
          </span>
        </button>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={4}
          onOpenAutoFocus={(e) => {
            // Land in the search box, not on the first country — typing is the
            // fast path through 199 options.
            e.preventDefault();
            searchRef.current?.focus();
          }}
          className="z-50 w-[--radix-popover-trigger-width] min-w-[280px] rounded-lg border border-border bg-card shadow-lg"
        >
          <div className="p-2 border-b border-border">
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search country or code"
              aria-label="Search countries"
              className="w-full border border-input rounded px-2 py-1.5 text-sm"
            />
          </div>
          <div role="listbox" aria-label="Countries" className="max-h-64 overflow-y-auto py-1">
            {allowClear && (
              <button
                type="button"
                role="option"
                aria-selected={value === null}
                onClick={() => pick(null)}
                className="w-full text-left px-3 py-2 text-sm hover:bg-muted text-muted-foreground"
              >
                No code — just “Phone number”
              </button>
            )}
            {results.length === 0 ? (
              <p className="px-3 py-4 text-sm text-muted-foreground">
                No country matches “{query}”.
              </p>
            ) : (
              results.map((c) => (
                <button
                  key={c.iso}
                  type="button"
                  role="option"
                  aria-selected={c.iso === value}
                  onClick={() => pick(c)}
                  className={`w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-muted ${
                    c.iso === value ? "bg-muted font-medium" : ""
                  }`}
                >
                  <span aria-hidden className="text-base leading-none w-6 shrink-0">
                    {flagOf(c.iso)}
                  </span>
                  <span className="flex-1 text-left">{c.name}</span>
                  <span className="text-muted-foreground tabular-nums">+{c.dial}</span>
                </button>
              ))
            )}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
