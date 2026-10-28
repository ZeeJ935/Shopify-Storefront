"use client";

import { useRef } from "react";
import type { ProductListItem } from "@/lib/products";
import ProductCard from "./product-card";

type ProductCarouselProps = {
  products: ProductListItem[];
  label: string;
  /** Dark band (e.g. sale strip) — light arrows + inverted card text. */
  tone?: "light" | "dark";
};

export default function ProductCarousel({
  products,
  label,
  tone = "light",
}: ProductCarouselProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const dark = tone === "dark";

  function scrollBy(dir: -1 | 1) {
    const el = scrollerRef.current;
    if (!el) return;
    const amount = el.clientWidth * 0.8;
    el.scrollBy({ left: dir * amount, behavior: "smooth" });
  }

  if (products.length === 0) return null;

  return (
    <div
      className={`relative ${
        dark
          ? "[&_h3]:text-snow [&_p]:text-mist [&_.text-ink]:text-snow [&_.text-steel]:text-mist [&_button]:text-snow [&_a]:text-snow"
          : ""
      }`}
    >
      <div className="mb-4 flex items-center justify-end gap-2">
        <button
          type="button"
          className={`hidden h-11 w-11 items-center justify-center md:inline-flex ${
            dark
              ? "border border-snow/40 text-snow hover:border-snow"
              : "border border-mist text-ink hover:border-ink"
          }`}
          aria-label={`Previous ${label}`}
          onClick={() => scrollBy(-1)}
        >
          ‹
        </button>
        <button
          type="button"
          className={`hidden h-11 w-11 items-center justify-center md:inline-flex ${
            dark
              ? "border border-snow/40 text-snow hover:border-snow"
              : "border border-mist text-ink hover:border-ink"
          }`}
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
            className="w-[calc((100%-1rem)/2)] min-w-0 shrink-0 snap-start sm:w-[calc((100%-2rem)/3)] lg:w-[calc((100%-3rem)/4)]"
          >
            <ProductCard product={product} />
          </div>
        ))}
      </div>
    </div>
  );
}
