"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { FacetGroup } from "@/lib/catalog-query";
import PriceRangeSlider from "./price-range-slider";

export type FilterDraft = {
  brand: string[];
  type: string[];
  gender: string[];
  size: string[];
  color: string[];
  sale: boolean;
  available: string | null; // "1" | "0" | null
  priceMin: number | null;
  priceMax: number | null;
};

type FiltersPanelProps = {
  facets: FacetGroup[];
  draft: FilterDraft;
  onChange: (next: FilterDraft) => void;
  priceBounds: { min: number; max: number };
  resultCount?: number;
  collapsible?: boolean;
};

function toggleMulti(list: string[], value: string): string[] {
  return list.includes(value)
    ? list.filter((v) => v !== value)
    : [...list, value];
}

function FacetGroupBlock({
  group,
  draft,
  onChange,
  defaultOpen,
}: {
  group: FacetGroup;
  draft: FilterDraft;
  onChange: (next: FilterDraft) => void;
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  const selected =
    group.id === "brand"
      ? draft.brand
      : group.id === "type"
        ? draft.type
        : group.id === "gender"
          ? draft.gender
          : group.id === "size"
            ? draft.size
            : group.id === "color"
              ? draft.color
              : group.id === "sale"
                ? draft.sale
                  ? ["1"]
                  : []
                : group.id === "available"
                  ? draft.available
                    ? [draft.available]
                    : []
                  : [];

  return (
    <div className="border-b border-mist py-3">
      <button
        type="button"
        className="flex min-h-11 w-full items-center justify-between text-left text-xs font-bold uppercase tracking-wider text-ink"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {group.label}
        <span aria-hidden="true">{open ? "−" : "+"}</span>
      </button>
      {open && (
        <ul className="mt-2 space-y-1">
          {group.values.map((value) => {
            const checked = selected.includes(value.value);
            return (
              <li key={value.value}>
                <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
                  <input
                    type="checkbox"
                    className="h-4 w-4"
                    checked={checked}
                    onChange={() => {
                      if (group.id === "sale") {
                        onChange({ ...draft, sale: !draft.sale });
                        return;
                      }
                      if (group.id === "available") {
                        onChange({
                          ...draft,
                          available:
                            draft.available === value.value ? null : value.value,
                        });
                        return;
                      }
                      const key = group.id as keyof Pick<
                        FilterDraft,
                        "brand" | "type" | "gender" | "size" | "color"
                      >;
                      onChange({
                        ...draft,
                        [key]: toggleMulti(draft[key], value.value),
                      });
                    }}
                  />
                  <span className="flex-1">{value.label}</span>
                  <span className="text-xs text-steel">{value.count}</span>
                </label>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export function FiltersPanel({
  facets,
  draft,
  onChange,
  priceBounds,
  resultCount,
  collapsible = true,
}: FiltersPanelProps) {
  return (
    <div className="space-y-2">
      {typeof resultCount === "number" && (
        <p className="text-sm text-steel" aria-live="polite">
          {resultCount} product{resultCount === 1 ? "" : "s"}
        </p>
      )}
      {facets.map((group, i) => (
        <FacetGroupBlock
          key={group.id}
          group={group}
          draft={draft}
          onChange={onChange}
          defaultOpen={!collapsible || i < 2}
        />
      ))}
      {priceBounds.max > priceBounds.min && (
        <div className="border-b border-mist py-3">
          <p className="mb-3 text-xs font-bold uppercase tracking-wider text-ink">
            Price
          </p>
          <PriceRangeSlider
            key={`${draft.priceMin ?? priceBounds.min}-${draft.priceMax ?? priceBounds.max}-${priceBounds.min}-${priceBounds.max}`}
            min={priceBounds.min}
            max={priceBounds.max}
            valueMin={draft.priceMin ?? priceBounds.min}
            valueMax={draft.priceMax ?? priceBounds.max}
            onCommit={(lo, hi) =>
              onChange({
                ...draft,
                priceMin: lo <= priceBounds.min ? null : lo,
                priceMax: hi >= priceBounds.max ? null : hi,
              })
            }
          />
        </div>
      )}
    </div>
  );
}

export function ActiveFilterChips({
  draft,
  onChange,
  onClearAll,
}: {
  draft: FilterDraft;
  onChange: (next: FilterDraft) => void;
  onClearAll: () => void;
}) {
  const chips: { key: string; label: string; clear: () => void }[] = [];

  for (const b of draft.brand) {
    chips.push({
      key: `brand-${b}`,
      label: `Brand: ${b}`,
      clear: () =>
        onChange({ ...draft, brand: draft.brand.filter((x) => x !== b) }),
    });
  }
  for (const t of draft.type) {
    chips.push({
      key: `type-${t}`,
      label: t,
      clear: () =>
        onChange({ ...draft, type: draft.type.filter((x) => x !== t) }),
    });
  }
  for (const g of draft.gender) {
    chips.push({
      key: `gender-${g}`,
      label: g,
      clear: () =>
        onChange({ ...draft, gender: draft.gender.filter((x) => x !== g) }),
    });
  }
  for (const s of draft.size) {
    chips.push({
      key: `size-${s}`,
      label: `Size: ${s}`,
      clear: () =>
        onChange({ ...draft, size: draft.size.filter((x) => x !== s) }),
    });
  }
  for (const c of draft.color) {
    chips.push({
      key: `color-${c}`,
      label: c,
      clear: () =>
        onChange({ ...draft, color: draft.color.filter((x) => x !== c) }),
    });
  }
  if (draft.sale) {
    chips.push({
      key: "sale",
      label: "On sale",
      clear: () => onChange({ ...draft, sale: false }),
    });
  }
  if (draft.available === "1") {
    chips.push({
      key: "avail-1",
      label: "In stock",
      clear: () => onChange({ ...draft, available: null }),
    });
  }
  if (draft.available === "0") {
    chips.push({
      key: "avail-0",
      label: "Out of stock",
      clear: () => onChange({ ...draft, available: null }),
    });
  }
  if (draft.priceMin !== null || draft.priceMax !== null) {
    chips.push({
      key: "price",
      label: `Price ${draft.priceMin ?? "…"}–${draft.priceMax ?? "…"}`,
      clear: () => onChange({ ...draft, priceMin: null, priceMax: null }),
    });
  }

  if (chips.length === 0) return null;

  return (
    <ul className="mb-4 flex flex-wrap gap-2">
      {chips.map((chip) => (
        <li key={chip.key}>
          <button
            type="button"
            className="inline-flex min-h-9 items-center gap-2 border border-mist bg-white px-3 text-xs font-medium hover:border-ink"
            onClick={chip.clear}
          >
            {chip.label}
            <span aria-hidden="true">×</span>
          </button>
        </li>
      ))}
      <li>
        <button
          type="button"
          className="min-h-9 px-2 text-xs font-semibold uppercase tracking-wide text-steel hover:underline"
          onClick={onClearAll}
        >
          Clear all
        </button>
      </li>
    </ul>
  );
}

export function FiltersDrawer({
  open,
  onClose,
  facets,
  draft,
  onChange,
  onApply,
  onClearAll,
  priceBounds,
  resultCount,
}: {
  open: boolean;
  onClose: () => void;
  facets: FacetGroup[];
  draft: FilterDraft;
  onChange: (next: FilterDraft) => void;
  onApply: () => void;
  onClearAll: () => void;
  priceBounds: { min: number; max: number };
  resultCount: number;
}) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    document.body.classList.add("is-scroll-locked");
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.classList.remove("is-scroll-locked");
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[70] lg:hidden"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <button
        type="button"
        className="absolute inset-0 bg-ink/40"
        aria-label="Close filters"
        onClick={onClose}
      />
      <div
        ref={panelRef}
        className="absolute inset-x-0 bottom-0 max-h-[85vh] overflow-y-auto rounded-t-lg bg-snow p-4 shadow-xl"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 id={titleId} className="font-display text-lg font-bold">
            Filters
          </h2>
          <button
            type="button"
            className="inline-flex h-11 w-11 items-center justify-center text-2xl"
            aria-label="Close"
            onClick={onClose}
          >
            ×
          </button>
        </div>
        <FiltersPanel
          facets={facets}
          draft={draft}
          onChange={onChange}
          priceBounds={priceBounds}
          resultCount={resultCount}
          collapsible={false}
        />
        <div className="mt-6 flex gap-2">
          <button type="button" className="btn btn-secondary flex-1" onClick={onClearAll}>
            Clear all
          </button>
          <button
            type="button"
            className="btn btn-primary flex-1"
            onClick={() => {
              onApply();
              onClose();
            }}
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}

export function draftFromSearchParams(sp: URLSearchParams): FilterDraft {
  return {
    brand: [...sp.getAll("brand"), ...sp.getAll("vendor")].filter(Boolean),
    type: sp.getAll("type"),
    gender: sp.getAll("gender"),
    size: sp.getAll("size"),
    color: sp.getAll("color"),
    sale: sp.get("sale") === "1" || sp.get("sale") === "true",
    available:
      sp.get("available") === "1" || sp.get("available") === "in-stock"
        ? "1"
        : sp.get("available") === "0" || sp.get("available") === "out-of-stock"
          ? "0"
          : null,
    priceMin: sp.get("price_min") ? Number(sp.get("price_min")) : null,
    priceMax: sp.get("price_max") ? Number(sp.get("price_max")) : null,
  };
}

export function emptyDraft(): FilterDraft {
  return {
    brand: [],
    type: [],
    gender: [],
    size: [],
    color: [],
    sale: false,
    available: null,
    priceMin: null,
    priceMax: null,
  };
}

export function applyDraftToParams(
  base: URLSearchParams,
  draft: FilterDraft,
  sort: string,
): URLSearchParams {
  const next = new URLSearchParams();
  if (sort && sort !== "featured") next.set("sort", sort);
  for (const b of draft.brand) next.append("brand", b);
  for (const t of draft.type) next.append("type", t);
  for (const g of draft.gender) next.append("gender", g);
  for (const s of draft.size) next.append("size", s);
  for (const c of draft.color) next.append("color", c);
  if (draft.sale) next.set("sale", "1");
  if (draft.available) next.set("available", draft.available);
  if (draft.priceMin !== null) next.set("price_min", String(draft.priceMin));
  if (draft.priceMax !== null) next.set("price_max", String(draft.priceMax));
  const scope = base.get("scope");
  if (scope) next.set("scope", scope);
  return next;
}
