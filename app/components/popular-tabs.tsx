"use client";

import { useState } from "react";
import type { ProductListItem } from "@/lib/products";
import ProductCard from "./product-card";

type PopularTabsProps = {
  men: ProductListItem[];
  women: ProductListItem[];
};

export default function PopularTabs({ men, women }: PopularTabsProps) {
  const hasMen = men.length > 0;
  const hasWomen = women.length > 0;
  const [tab, setTab] = useState<"men" | "women">(
    hasMen ? "men" : "women",
  );

  if (!hasMen && !hasWomen) return null;

  const products = tab === "men" ? men : women;

  return (
    <div>
      <div
        role="tablist"
        aria-label="Popular right now"
        className="mb-8 flex gap-2"
      >
        {hasMen && (
          <button
            type="button"
            role="tab"
            aria-selected={tab === "men"}
            className={`min-h-11 px-4 text-sm font-bold uppercase tracking-wide ${
              tab === "men"
                ? "bg-ink text-snow"
                : "border border-mist text-ink hover:border-ink"
            }`}
            onClick={() => setTab("men")}
          >
            Men
          </button>
        )}
        {hasWomen && (
          <button
            type="button"
            role="tab"
            aria-selected={tab === "women"}
            className={`min-h-11 px-4 text-sm font-bold uppercase tracking-wide ${
              tab === "women"
                ? "bg-ink text-snow"
                : "border border-mist text-ink hover:border-ink"
            }`}
            onClick={() => setTab("women")}
          >
            Women
          </button>
        )}
      </div>
      <div
        role="tabpanel"
        className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4 lg:gap-6"
      >
        {products.slice(0, 8).map((product) => (
          <div key={product.id} className="min-w-0">
            <ProductCard product={product} />
          </div>
        ))}
      </div>
    </div>
  );
}
