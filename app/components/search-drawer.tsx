"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";

type PredictiveProduct = {
  id: string;
  handle: string;
  title: string;
  vendor: string;
  featuredImage: { url: string; altText: string | null } | null;
  priceRange: { minVariantPrice: { amount: string; currencyCode: string } };
};

type PredictivePayload = {
  products: PredictiveProduct[];
  collections: { handle: string; title: string }[];
  queries: { text: string; styledText: string }[];
};

type SearchDrawerProps = {
  open: boolean;
  onClose: () => void;
};

export default function SearchDrawer({ open, onClose }: SearchDrawerProps) {
  const router = useRouter();
  const titleId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [data, setData] = useState<PredictivePayload | null>(null);
  const [activeIndex, setActiveIndex] = useState(-1);
  const debounceRef = useRef<number | null>(null);

  // The header passes an inline onClose; a ref keeps the effect below from
  // re-running (and re-recording focus) on every render.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open || !panelRef.current) return;
    const panel = panelRef.current;
    const previouslyFocused = document.activeElement as HTMLElement | null;

    document.body.classList.add("is-scroll-locked");
    inputRef.current?.focus();

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab") return;

      // Results change as the shopper types, so query focusables per keypress.
      const focusables = panel.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    }

    window.addEventListener("keydown", onKey);
    return () => {
      document.body.classList.remove("is-scroll-locked");
      window.removeEventListener("keydown", onKey);
      previouslyFocused?.focus();
    };
  }, [open]);

  const fetchPredictive = useCallback((q: string) => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(async () => {
      if (!q.trim()) {
        setData(null);
        return;
      }
      try {
        const res = await fetch(
          `/api/predictive-search?q=${encodeURIComponent(q)}`,
        );
        // 400 (too long) / 429 (rate limited) bodies aren't result payloads.
        if (!res.ok) {
          setData(null);
          return;
        }
        const json = (await res.json()) as PredictivePayload;
        setData(json);
        setActiveIndex(-1);
      } catch {
        setData(null);
      }
    }, 250);
  }, []);

  useEffect(() => {
    fetchPredictive(query);
  }, [query, fetchPredictive]);

  if (!open) return null;

  const flatLinks: { href: string; label: string }[] = [];
  if (data) {
    for (const q of data.queries) {
      flatLinks.push({
        href: `/search?q=${encodeURIComponent(q.text)}`,
        label: q.text,
      });
    }
    for (const c of data.collections) {
      flatLinks.push({
        href: `/collections/${c.handle}`,
        label: c.title,
      });
    }
    for (const p of data.products) {
      flatLinks.push({
        href: `/products/${p.handle}`,
        label: p.title,
      });
    }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, flatLinks.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, -1));
    } else if (e.key === "Enter") {
      if (activeIndex >= 0 && flatLinks[activeIndex]) {
        e.preventDefault();
        router.push(flatLinks[activeIndex].href);
        onClose();
      } else if (query.trim()) {
        e.preventDefault();
        router.push(`/search?q=${encodeURIComponent(query.trim())}`);
        onClose();
      }
    }
  }

  return (
    <div
      className="fixed inset-0 z-[80]"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <button
        type="button"
        className="absolute inset-0 bg-ink/40"
        aria-label="Close search"
        onClick={onClose}
      />
      <div
        ref={panelRef}
        className="absolute inset-x-0 top-0 max-h-[90vh] overflow-y-auto border-b border-mist bg-snow shadow-lg"
      >
        <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
          <div className="flex items-center justify-between gap-4">
            <h2 id={titleId} className="font-display text-lg font-bold">
              Search
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
          <label htmlFor="predictive-q" className="sr-only">
            Search products
          </label>
          <input
            ref={inputRef}
            id="predictive-q"
            type="search"
            maxLength={100}
            className="field mt-4"
            placeholder="Search products, collections…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            autoComplete="off"
          />

          {data && (
            <div className="mt-6 space-y-6" aria-live="polite">
              {data.queries.length > 0 && (
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-steel">
                    Suggestions
                  </p>
                  <ul className="mt-2">
                    {data.queries.map((q, i) => (
                      <li key={q.text}>
                        <Link
                          href={`/search?q=${encodeURIComponent(q.text)}`}
                          className={`flex min-h-11 items-center px-2 text-sm ${
                            activeIndex === i ? "bg-mist" : ""
                          }`}
                          onClick={onClose}
                        >
                          {q.text}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {data.collections.length > 0 && (
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-steel">
                    Collections
                  </p>
                  <ul className="mt-2">
                    {data.collections.map((c, i) => {
                      const idx = data.queries.length + i;
                      return (
                        <li key={c.handle}>
                          <Link
                            href={`/collections/${c.handle}`}
                            className={`flex min-h-11 items-center px-2 text-sm ${
                              activeIndex === idx ? "bg-mist" : ""
                            }`}
                            onClick={onClose}
                          >
                            {c.title}
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
              {data.products.length > 0 && (
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-steel">
                    Products
                  </p>
                  <ul className="mt-2 divide-y divide-mist">
                    {data.products.map((p, i) => {
                      const idx =
                        data.queries.length + data.collections.length + i;
                      return (
                        <li key={p.id}>
                          <Link
                            href={`/products/${p.handle}`}
                            className={`flex min-h-14 items-center gap-3 px-2 py-2 ${
                              activeIndex === idx ? "bg-mist" : ""
                            }`}
                            onClick={onClose}
                          >
                            <span className="relative h-12 w-12 shrink-0 overflow-hidden bg-mist">
                              {p.featuredImage && (
                                <Image
                                  src={p.featuredImage.url}
                                  alt=""
                                  fill
                                  sizes="48px"
                                  className="object-cover"
                                />
                              )}
                            </span>
                            <span>
                              <span className="block text-sm font-medium">
                                {p.title}
                              </span>
                              <span className="text-xs text-steel">
                                {p.vendor}
                              </span>
                            </span>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
              {query.trim() && (
                <Link
                  href={`/search?q=${encodeURIComponent(query.trim())}`}
                  className="btn btn-secondary w-full"
                  onClick={onClose}
                >
                  View all results for “{query.trim()}”
                </Link>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
