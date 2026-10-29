"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useTransition,
} from "react";
import ProductCard from "@/app/components/product-card";
import Skeleton from "@/app/components/skeleton";
import type { FacetGroup, CatalogSort } from "@/lib/catalog-query";
import type { ProductListItem } from "@/lib/products";
import {
  ActiveFilterChips,
  applyDraftToParams,
  draftFromSearchParams,
  emptyDraft,
  FiltersDrawer,
  FiltersPanel,
  type FilterDraft,
} from "./collection-filters";

type CollectionBrowseProps = {
  scope: string | null;
  initialProducts: ProductListItem[];
  initialTotal: number;
  initialPage: number;
  initialHasNextPage: boolean;
  facets: FacetGroup[];
  priceBounds: { min: number; max: number };
  sortOptions: { value: CatalogSort; label: string }[];
  initialSort: CatalogSort;
};

type CatalogApiResponse = {
  products: ProductListItem[];
  total: number;
  page: number;
  pageCount: number;
  hasNextPage: boolean;
  facets: FacetGroup[];
  priceBounds: { min: number; max: number };
};

type SavedBrowse = {
  products: ProductListItem[];
  total: number;
  page: number;
  hasNext: boolean;
  scrollY: number;
};

function storageKey(path: string, query: string) {
  return `catalog-scroll:${path}?${query}`;
}

function readSaved(path: string, query: string): SavedBrowse | null {
  try {
    const raw = sessionStorage.getItem(storageKey(path, query));
    if (!raw) return null;
    return JSON.parse(raw) as SavedBrowse;
  } catch {
    return null;
  }
}

export default function CollectionBrowse({
  scope,
  initialProducts,
  initialTotal,
  initialPage,
  initialHasNextPage,
  facets: initialFacets,
  priceBounds: initialBounds,
  sortOptions,
  initialSort,
}: CollectionBrowseProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const gridRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const loadingRef = useRef(false);
  const restoredRef = useRef(false);

  const queryKey = searchParams.toString();

  const [products, setProducts] = useState(initialProducts);
  const [total, setTotal] = useState(initialTotal);
  const [page, setPage] = useState(initialPage);
  const [hasNext, setHasNext] = useState(initialHasNextPage);
  const [facets, setFacets] = useState(initialFacets);
  const [priceBounds, setPriceBounds] = useState(initialBounds);
  const [loadingMore, setLoadingMore] = useState(false);
  // Set when fetching the next page fails; pauses auto-loading until a retry.
  const [loadError, setLoadError] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [draft, setDraft] = useState(() =>
    draftFromSearchParams(new URLSearchParams(queryKey)),
  );
  const [sort, setSort] = useState<CatalogSort>(initialSort);
  const [, startTransition] = useTransition();

  // Best-effort scroll/list restore after mount (sessionStorage).
  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    const saved = readSaved(pathname, queryKey);
    if (!saved?.products?.length) return;
    const t = window.setTimeout(() => {
      setProducts(saved.products);
      setTotal(saved.total);
      setPage(saved.page);
      setHasNext(saved.hasNext);
      window.scrollTo(0, saved.scrollY || 0);
    }, 0);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- restore once per mount (keyed by URL)
  }, []);

  useEffect(() => {
    function persist() {
      try {
        sessionStorage.setItem(
          storageKey(pathname, queryKey),
          JSON.stringify({
            products,
            total,
            page,
            hasNext,
            scrollY: window.scrollY,
          }),
        );
      } catch {
        /* ignore */
      }
    }
    window.addEventListener("pagehide", persist);
    return () => {
      persist();
      window.removeEventListener("pagehide", persist);
    };
  }, [pathname, queryKey, products, total, page, hasNext]);

  const buildApiUrl = useCallback(
    (pageNum: number, params: URLSearchParams) => {
      const p = new URLSearchParams(params.toString());
      p.set("page", String(pageNum));
      if (scope) p.set("scope", scope);
      return `/api/catalog?${p.toString()}`;
    },
    [scope],
  );

  const loadPage = useCallback(
    async (pageNum: number, append: boolean) => {
      if (loadingRef.current) return;
      loadingRef.current = true;
      setLoadError(false);
      if (append) setLoadingMore(true);
      try {
        const params = new URLSearchParams(searchParams.toString());
        const res = await fetch(buildApiUrl(pageNum, params));
        if (!res.ok) throw new Error("fetch failed");
        const data = (await res.json()) as CatalogApiResponse;
        setTotal(data.total);
        setPage(data.page);
        setHasNext(data.hasNextPage);
        setFacets(data.facets);
        setPriceBounds(data.priceBounds);
        setProducts((prev) => {
          if (!append) return data.products;
          const seen = new Set(prev.map((p) => p.id));
          const next = [...prev];
          for (const p of data.products) {
            if (!seen.has(p.id)) {
              seen.add(p.id);
              next.push(p);
            }
          }
          return next;
        });
      } catch {
        // Keep what's shown, and let the shopper retry instead of stalling silently.
        setLoadError(true);
      } finally {
        loadingRef.current = false;
        setLoadingMore(false);
      }
    },
    [buildApiUrl, searchParams],
  );

  useEffect(() => {
    const el = sentinelRef.current;
    // After a failure, wait for "Try again" rather than retrying on every scroll.
    if (!el || !hasNext || loadError) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          void loadPage(page + 1, true);
        }
      },
      { rootMargin: "600px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [hasNext, page, loadPage, loadError]);

  function replaceUrl(next: URLSearchParams) {
    const qs = next.toString();
    startTransition(() => {
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    });
    gridRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function commitDraft(nextDraft: FilterDraft, nextSort = sort) {
    setDraft(nextDraft);
    const next = applyDraftToParams(
      new URLSearchParams(searchParams.toString()),
      nextDraft,
      nextSort,
    );
    replaceUrl(next);
  }

  function onSortChange(value: string) {
    const nextSort = value as CatalogSort;
    setSort(nextSort);
    const next = applyDraftToParams(
      new URLSearchParams(searchParams.toString()),
      draft,
      nextSort,
    );
    replaceUrl(next);
  }

  function clearAll() {
    commitDraft(emptyDraft(), sort);
  }

  return (
    <div className="flex gap-10">
      <aside className="hidden w-56 shrink-0 self-start lg:block xl:w-64">
        <div className="sticky top-28 flex max-h-[calc(100vh-7.5rem)] flex-col overflow-hidden">
          <h2 className="mb-4 shrink-0 text-xs font-bold uppercase tracking-wider text-steel">
            Filters
          </h2>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
            <FiltersPanel
              facets={facets}
              draft={draft}
              onChange={(d) => commitDraft(d)}
              priceBounds={priceBounds}
            />
          </div>
        </div>
      </aside>

      <div className="min-w-0 flex-1" ref={gridRef}>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-mist py-4">
          <p className="text-sm text-steel">
            {products.length} of {total} product{total === 1 ? "" : "s"}
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              className="btn btn-secondary min-h-11 lg:hidden"
              onClick={() => setFiltersOpen(true)}
            >
              Filters
            </button>
            <label className="flex items-center gap-3 text-sm">
              <span className="shrink-0 text-steel">Sort</span>
              <select
                className="field select-field min-h-11 min-w-[12rem] py-2 leading-normal"
                value={sort}
                onChange={(e) => onSortChange(e.target.value)}
              >
                {sortOptions.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>

        <div className="mt-4">
          <ActiveFilterChips
            draft={draft}
            onChange={(d) => commitDraft(d)}
            onClearAll={clearAll}
          />
        </div>

        {products.length === 0 ? (
          <p className="mt-10 rounded border border-mist bg-white p-6 text-steel">
            No products match these filters.
          </p>
        ) : (
          <div className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4 lg:gap-6">
            {products.map((product) => (
              <div key={product.id} className="min-w-0">
                <ProductCard product={product} />
              </div>
            ))}
          </div>
        )}

        {loadingMore && (
          <div className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4 lg:gap-6">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton
                key={i}
                className="aspect-[4/5] w-full skeleton-shimmer"
              />
            ))}
          </div>
        )}

        <div ref={sentinelRef} className="h-4" aria-hidden="true" />

        {hasNext && !loadingMore && (
          <div
            className="mt-8 flex flex-col items-center gap-3"
            role={loadError ? "alert" : undefined}
          >
            {loadError ? (
              <p className="text-sm text-danger">
                Couldn&apos;t load more products.
              </p>
            ) : null}
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => void loadPage(page + 1, true)}
            >
              {loadError ? "Try again" : "Load more"}
            </button>
          </div>
        )}

        {!hasNext && total > 0 && (
          <p className="mt-10 text-center text-sm text-steel">
            You&apos;ve seen all {total} products
          </p>
        )}
      </div>

      <FiltersDrawer
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        facets={facets}
        draft={draft}
        onChange={setDraft}
        onApply={() => commitDraft(draft)}
        onClearAll={() => {
          const cleared = emptyDraft();
          setDraft(cleared);
          commitDraft(cleared);
        }}
        priceBounds={priceBounds}
        resultCount={total}
      />
    </div>
  );
}
