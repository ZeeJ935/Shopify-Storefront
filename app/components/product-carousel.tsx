"use client";

import { useRef } from "react";
import type { ProductListItem } from "@/lib/products";
import ProductCard from "./product-card";

type ProductCarouselProps = {
  products: ProductListItem[];
  label: string;
};

export default function ProductCarousel({
  products,
  label,
}: ProductCarouselProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);

  function scrollBy(dir: -1 | 1) {
    const el = scrollerRef.current;
    if (!el) return;
    const amount = el.clientWidth * 0.8;
    el.scrollBy({ left: dir * amount, behavior: "smooth" });
  }

  if (products.length === 0) return null;

  return (
    <div className="relative">
      <div className="mb-4 flex items-center justify-end gap-2">
        <button
          type="button"
          className="hidden h-11 w-11 items-center justify-center border border-mist text-ink hover:border-ink md:inline-flex"
          aria-label={`Previous ${label}`}
          onClick={() => scrollBy(-1)}
        >
          ‹
        </button>
        <button
          type="button"
          className="hidden h-11 w-11 items-center justify-center border border-mist text-ink hover:border-ink md:inline-flex"
          aria-label={`Next ${label}`}
          onClick={() => scrollBy(1)}
        >
          ›
        </button>
      </div>
      <div
        ref={scrollerRef}
        className="flex snap-x snap-mandatory gap-4 overflow-x-auto pb-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        role="list"
        aria-label={label}
      >
        {products.map((product) => (
          <div
            key={product.id}
            role="listitem"
            className="w-[calc(50%-0.5rem)] min-w-0 shrink-0 snap-start md:w-[calc(25%-0.75rem)]"
          >
            <ProductCard product={product} />
          </div>
        ))}
      </div>
    </div>
  );
}
