// Shared with the backend (backend/src/catalog-shared/ is an identical copy: npm run sync:shared).
// The catalog's filter and sort rules for one product. Pure, no runtime imports.
import type { ProductListItem } from "./types.js";

export function productSizeValues(product: ProductListItem): string[] {
  const sizes = new Set<string>();
  for (const v of product.variants) {
    for (const o of v.selectedOptions) {
      if (o.name.toLowerCase() === "size") sizes.add(o.value);
    }
  }
  return [...sizes];
}

export function productIsOnSale(product: ProductListItem): boolean {
  if (!product.compareAtPrice) return false;
  return (
    Number(product.compareAtPrice.amount) >
    Number(product.priceRange.minVariantPrice.amount)
  );
}

export function productIsAvailable(product: ProductListItem): boolean {
  return product.availableForSale;
}

export function productMinPrice(product: ProductListItem): number {
  return Number(product.priceRange.minVariantPrice.amount);
}

const SIZE_ALPHA = [
  "XXS",
  "XS",
  "S",
  "M",
  "L",
  "XL",
  "2XL",
  "XXL",
  "3XL",
  "XXXL",
  "4XL",
];

export function compareSizes(a: string, b: string): number {
  const ua = a.toUpperCase();
  const ub = b.toUpperCase();
  const ia = SIZE_ALPHA.indexOf(ua);
  const ib = SIZE_ALPHA.indexOf(ub);
  if (ia !== -1 && ib !== -1) return ia - ib;
  if (ia !== -1) return -1;
  if (ib !== -1) return 1;
  const na = parseFloat(a);
  const nb = parseFloat(b);
  if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

/** Same comparison the catalog's name sort uses (case- and accent-insensitive). */
export function compareTitles(a: string, b: string): number {
  return a.trim().localeCompare(b.trim(), undefined, { sensitivity: "base" });
}
