import { productIsOnSale, productMinPrice, productSizeValues } from "../catalog-shared/catalog-rules.js";
import { genderTagsFromProduct, primaryColorTag } from "../catalog-shared/tag-classify.js";
import type { ProductListItem } from "../catalog-shared/types.js";

/** Collections the storefront browses (same list as the app's TRACKED_COLLECTIONS). */
export const TRACKED_COLLECTIONS = [
  "men",
  "women",
  "kids",
  "nike",
  "adidas",
  "sale",
  "trending",
  "shoes",
  "clothing",
  "accessories",
] as const;

export const isTracked = (handle: string) => (TRACKED_COLLECTIONS as readonly string[]).includes(handle);

/** The catalog's matching key: case-insensitive, trimmed (the old `eqi`). */
export const key = (value: string) => value.trim().toLowerCase();

const uniqueKeys = (values: string[]) => [...new Set(values.map(key).filter(Boolean))];

/** Columns for one product, derived with the same shared rules the in-memory catalog used. */
export function deriveRow(item: ProductListItem, updatedAt: string | null) {
  const genderTags = genderTagsFromProduct(item.tags);
  const sizes = productSizeValues(item);
  const color = primaryColorTag(item.tags);
  const prices = item.variants.map((v) => Number(v.price.amount)).filter(Number.isFinite);
  const minPrice = productMinPrice(item);
  return {
    id: item.id,
    handle: item.handle,
    title: item.title,
    vendor: item.vendor,
    productType: item.productType,
    tags: item.tags,
    available: item.availableForSale,
    minPrice: String(minPrice),
    maxPrice: String(prices.length ? Math.max(minPrice, ...prices) : minPrice),
    currency: item.priceRange.minVariantPrice.currencyCode,
    createdAt: item.createdAt ? new Date(item.createdAt) : null,
    updatedAt: updatedAt ? new Date(updatedAt) : null,
    data: item,
    vendorKey: key(item.vendor),
    typeKey: key(item.productType),
    genderTags,
    genderKeys: uniqueKeys(genderTags),
    sizes,
    sizeKeys: uniqueKeys(sizes),
    color,
    colorKey: color ? key(color) : null,
    onSale: productIsOnSale(item),
  };
}

export type ProductRow = ReturnType<typeof deriveRow>;
