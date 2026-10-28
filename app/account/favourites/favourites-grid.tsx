"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import ProductCard from "@/app/components/product-card";
import { useFavorites } from "@/app/components/favorites-provider";
import { loadFavouriteProducts } from "@/app/favourites/actions";
import type { ProductListItem } from "@/lib/products";
import Skeleton from "@/app/components/skeleton";

export default function FavouritesGrid() {
  const { hydrated, ids, count } = useFavorites();
  const [products, setProducts] = useState<ProductListItem[]>([]);
  const [pending, startTransition] = useTransition();
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!hydrated) return;

    const list = [...ids];
    if (list.length === 0) {
      setProducts([]);
      setLoaded(true);
      return;
    }

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

  if (!hydrated || (!loaded && pending)) {
    return (
      <div className="grid grid-cols-2 gap-4 sm:gap-6 lg:grid-cols-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="aspect-[4/5] w-full rounded-lg" />
        ))}
      </div>
    );
  }

  if (count === 0 || products.length === 0) {
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
      {products.map((product) => (
        <li key={product.id}>
          <ProductCard product={product} />
        </li>
      ))}
    </ul>
  );
}
