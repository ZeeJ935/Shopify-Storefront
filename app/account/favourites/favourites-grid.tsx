"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import ProductCard from "@/app/components/product-card";
import { useFavorites } from "@/app/components/favorites-provider";
import { loadFavouriteProducts } from "@/app/favourites/actions";
import type { ProductListItem } from "@/lib/products";
import Skeleton from "@/app/components/skeleton";

export default function FavouritesGrid() {
  const { hydrated, ids, count, loadFailed, retry } = useFavorites();
  const [retrying, setRetrying] = useState(false);
  const [products, setProducts] = useState<ProductListItem[]>([]);
  const [pending, startTransition] = useTransition();
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    // An empty list needs no fetch; the empty state is derived below.
    if (!hydrated || ids.size === 0) return;

    const list = [...ids];
    startTransition(async () => {
      try {
        const next = await loadFavouriteProducts(list);
        setProducts(next);
      } catch {
        setProducts([]);
      } finally {
        setLoaded(true);
      }
    });
  }, [hydrated, ids]);

  // Hide un-favourited products immediately, before any refetch lands.
  const visibleProducts = products.filter((product) => ids.has(product.id));

  if (!hydrated || (ids.size > 0 && !loaded && pending)) {
    return (
      <div className="grid grid-cols-2 gap-4 sm:gap-6 lg:grid-cols-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="aspect-[4/5] w-full rounded-lg" />
        ))}
      </div>
    );
  }

  // The saved list couldn't be read (for example the favourites service is
  // down). Say so instead of "No favourites yet": nothing has been deleted.
  if (loadFailed) {
    return (
      <div role="alert" className="rounded-xl border border-mist bg-snow px-6 py-16 text-center shadow-sm">
        <h2 className="font-display text-xl font-semibold text-ink">
          We couldn’t load your favourites
        </h2>
        <p className="mt-2 text-sm text-steel">
          Your saved items are safe. Please try again in a moment.
        </p>
        <button
          type="button"
          className="btn btn-primary mt-8"
          disabled={retrying}
          onClick={() => {
            setRetrying(true);
            void retry().finally(() => setRetrying(false));
          }}
        >
          {retrying ? "Trying again…" : "Try again"}
        </button>
      </div>
    );
  }

  if (count === 0 || visibleProducts.length === 0) {
    return (
      <div className="rounded-xl border border-mist bg-snow px-6 py-16 text-center shadow-sm">
        <h2 className="font-display text-xl font-semibold text-ink">
          No favourites yet
        </h2>
        <p className="mt-2 text-sm text-steel">
          Tap the heart on any product to save it here.
        </p>
        <Link href="/collections/all" className="btn btn-primary mt-8">
          Start shopping
        </Link>
      </div>
    );
  }

  return (
    <ul className="grid grid-cols-2 gap-4 sm:gap-6 lg:grid-cols-3">
      {visibleProducts.map((product) => (
        <li key={product.id}>
          <ProductCard product={product} />
        </li>
      ))}
    </ul>
  );
}
