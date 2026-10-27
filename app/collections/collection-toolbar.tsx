"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useCallback, useTransition } from "react";

const SORT_OPTIONS = [
  { value: "featured", label: "Featured" },
  { value: "best-selling", label: "Best selling" },
  { value: "price-asc", label: "Price: low–high" },
  { value: "price-desc", label: "Price: high–low" },
  { value: "newest", label: "Newest" },
] as const;

type CollectionToolbarProps = {
  productCount: number;
  onOpenFilters?: () => void;
  showFilterButton?: boolean;
};

export default function CollectionToolbar({
  productCount,
  onOpenFilters,
  showFilterButton = false,
}: CollectionToolbarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const sort = searchParams.get("sort") ?? "featured";

  const setSort = useCallback(
    (value: string) => {
      const next = new URLSearchParams(searchParams.toString());
      if (value === "featured") next.delete("sort");
      else next.set("sort", value);
      next.delete("after");
      startTransition(() => {
        router.push(`${pathname}?${next.toString()}`, { scroll: false });
      });
    },
    [pathname, router, searchParams],
  );

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-mist py-4">
      <p className="text-sm text-steel">
        {productCount} product{productCount === 1 ? "" : "s"}
        {pending ? " · Updating…" : ""}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {showFilterButton && onOpenFilters && (
          <button
            type="button"
            className="btn btn-secondary min-h-11 lg:hidden"
            onClick={onOpenFilters}
          >
            Filters
          </button>
        )}
        <label className="flex items-center gap-2 text-sm">
          <span className="text-steel">Sort</span>
          <select
            className="field min-h-11 w-auto py-2"
            value={sort}
            onChange={(e) => setSort(e.target.value)}
          >
            {SORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      </div>
    </div>
  );
}
