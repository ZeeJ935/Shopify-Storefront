import type { CatalogSnapshot } from "./catalog-snapshot";
import {
  compareSizes,
  productIsAvailable,
  productIsOnSale,
  productMinPrice,
  productSizeValues,
} from "./catalog-shared/catalog-rules";
import {
  genderTagsFromProduct,
  primaryColorTag,
} from "./catalog-shared/tag-classify";
import type {
  CatalogFilters,
  CatalogRaw,
  CatalogSort,
  FacetValue,
  ProductListItem,
} from "./catalog-shared/types";
import { preferredBrands } from "./site-content";

export type { CatalogFilters, CatalogSort, FacetValue } from "./catalog-shared/types";

export const PAGE_SIZE = 24;

/** Collections whose membership the catalog knows (same list as the snapshot and the backend). */
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

export type FacetGroup = {
  id: string;
  label: string;
  values: FacetValue[];
};

export type CatalogQueryResult = {
  products: ProductListItem[];
  total: number;
  page: number;
  pageCount: number;
  hasNextPage: boolean;
  facets: FacetGroup[];
  priceBounds: { min: number; max: number };
  sort: CatalogSort;
  sortOptions: { value: CatalogSort; label: string }[];
  hideGenderFacet: boolean;
};

export type CatalogQueryOptions = {
  scope?: string | null;
  filters: CatalogFilters;
  sort: CatalogSort;
  page?: number;
};

export function parseCatalogParams(
  params: URLSearchParams,
): {
  filters: CatalogFilters;
  sort: CatalogSort;
  page: number;
  scope: string | null;
} {
  const brand = [
    ...params.getAll("brand"),
    ...params.getAll("vendor"), // legacy
  ].filter(Boolean);

  const filters: CatalogFilters = {
    brand: unique(brand),
    type: unique(params.getAll("type")),
    gender: unique(params.getAll("gender")),
    size: unique(params.getAll("size")),
    color: unique(params.getAll("color")),
    sale: params.get("sale") === "1" || params.get("sale") === "true" ? true : null,
    available:
      params.get("available") === "1" || params.get("available") === "in-stock"
        ? true
        : params.get("available") === "0" ||
            params.get("available") === "out-of-stock"
          ? false
          : null,
    priceMin: numOrNull(params.get("price_min")),
    priceMax: numOrNull(params.get("price_max")),
  };

  const sortRaw = params.get("sort") ?? "featured";
  const sort = normalizeSort(sortRaw);

  const page = Math.max(1, Number(params.get("page") ?? "1") || 1);
  const scope = params.get("scope") || params.get("collection") || null;

  return { filters, sort, page, scope };
}

function normalizeSort(raw: string): CatalogSort {
  switch (raw) {
    case "latest":
    case "newest":
      return "latest";
    case "price-asc":
      return "price-asc";
    case "price-desc":
      return "price-desc";
    case "name-asc":
    case "title-asc":
      return "name-asc";
    case "name-desc":
    case "title-desc":
      return "name-desc";
    case "best-selling":
      return "best-selling";
    case "featured":
    default:
      return "featured";
  }
}

function numOrNull(v: string | null): number | null {
  if (v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function unique(arr: string[]) {
  return [...new Set(arr.map((s) => s.trim()).filter(Boolean))];
}

function matchesFilters(
  product: ProductListItem,
  filters: CatalogFilters,
): boolean {
  if (filters.brand.length && !filters.brand.some((b) => eqi(b, product.vendor))) {
    return false;
  }
  if (
    filters.type.length &&
    !filters.type.some((t) => eqi(t, product.productType))
  ) {
    return false;
  }
  if (filters.gender.length) {
    const genders = genderTagsFromProduct(product.tags);
    if (
      !filters.gender.some((g) =>
        genders.some((pg) => eqi(g, pg)),
      )
    ) {
      return false;
    }
  }
  if (filters.size.length) {
    const sizes = productSizeValues(product);
    if (!filters.size.some((s) => sizes.some((ps) => eqi(s, ps)))) {
      return false;
    }
  }
  if (filters.color.length) {
    const color = primaryColorTag(product.tags);
    if (!color || !filters.color.some((c) => eqi(c, color))) {
      return false;
    }
  }
  if (filters.sale === true && !productIsOnSale(product)) return false;
  if (filters.available === true && !productIsAvailable(product)) return false;
  if (filters.available === false && productIsAvailable(product)) return false;

  const price = productMinPrice(product);
  if (filters.priceMin !== null && price < filters.priceMin) return false;
  if (filters.priceMax !== null && price > filters.priceMax) return false;

  return true;
}

function eqi(a: string, b: string) {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function sortProducts(
  products: ProductListItem[],
  sort: CatalogSort,
  bestSellingOrder: string[],
  collectionOrder: string[] | null,
): ProductListItem[] {
  const list = [...products];
  const bestIndex = new Map(bestSellingOrder.map((id, i) => [id, i]));
  const colIndex = collectionOrder
    ? new Map(collectionOrder.map((id, i) => [id, i]))
    : null;

  switch (sort) {
    case "latest":
      return list.sort((a, b) => {
        const ta = Date.parse(a.createdAt ?? "") || 0;
        const tb = Date.parse(b.createdAt ?? "") || 0;
        return tb - ta;
      });
    case "price-asc":
      return list.sort((a, b) => productMinPrice(a) - productMinPrice(b));
    case "price-desc":
      return list.sort((a, b) => productMinPrice(b) - productMinPrice(a));
    case "name-asc":
      return list.sort((a, b) =>
        a.title.trim().localeCompare(b.title.trim(), undefined, {
          sensitivity: "base",
        }),
      );
    case "name-desc":
      return list.sort((a, b) =>
        b.title.trim().localeCompare(a.title.trim(), undefined, {
          sensitivity: "base",
        }),
      );
    case "best-selling":
      return list.sort((a, b) => {
        const ia = bestIndex.get(a.id) ?? Number.MAX_SAFE_INTEGER;
        const ib = bestIndex.get(b.id) ?? Number.MAX_SAFE_INTEGER;
        return ia - ib;
      });
    case "featured":
    default:
      if (colIndex) {
        return list.sort((a, b) => {
          const ia = colIndex.get(a.id) ?? Number.MAX_SAFE_INTEGER;
          const ib = colIndex.get(b.id) ?? Number.MAX_SAFE_INTEGER;
          return ia - ib;
        });
      }
      return list.sort((a, b) => {
        const ia = bestIndex.get(a.id) ?? Number.MAX_SAFE_INTEGER;
        const ib = bestIndex.get(b.id) ?? Number.MAX_SAFE_INTEGER;
        return ia - ib;
      });
  }
}

function countFacet(
  products: ProductListItem[],
  getKeys: (p: ProductListItem) => string[],
): FacetValue[] {
  const counts = new Map<string, { label: string; count: number }>();
  for (const p of products) {
    const seen = new Set<string>();
    for (const key of getKeys(p)) {
      const norm = key.trim();
      if (!norm || seen.has(norm.toLowerCase())) continue;
      seen.add(norm.toLowerCase());
      const existing = counts.get(norm.toLowerCase());
      if (existing) existing.count += 1;
      else counts.set(norm.toLowerCase(), { label: norm, count: 1 });
    }
  }
  return [...counts.values()]
    .filter((v) => v.count > 0)
    .map((v) => ({ value: v.label, label: v.label, count: v.count }));
}

function applyExcept(
  products: ProductListItem[],
  filters: CatalogFilters,
  except: (keyof CatalogFilters)[],
): ProductListItem[] {
  const partial: CatalogFilters = {
    brand: except.includes("brand") ? [] : filters.brand,
    type: except.includes("type") ? [] : filters.type,
    gender: except.includes("gender") ? [] : filters.gender,
    size: except.includes("size") ? [] : filters.size,
    color: except.includes("color") ? [] : filters.color,
    sale: except.includes("sale") ? null : filters.sale,
    available: except.includes("available") ? null : filters.available,
    priceMin: except.includes("priceMin") ? null : filters.priceMin,
    priceMax: except.includes("priceMax") ? null : filters.priceMax,
  };
  return products.filter((p) => matchesFilters(p, partial));
}

const brandKeys = (p: ProductListItem) => [p.vendor];
const typeKeys = (p: ProductListItem) => (p.productType ? [p.productType] : []);
const genderKeys = (p: ProductListItem) => genderTagsFromProduct(p.tags);
const sizeKeys = (p: ProductListItem) => productSizeValues(p);
const colorKeys = (p: ProductListItem) => {
  const c = primaryColorTag(p.tags);
  return c ? [c] : [];
};

/**
 * The catalog's data for one query, computed in memory from the snapshot.
 * TODO(remove after catalog migration verified): the backend's SQL now produces
 * the same CatalogRaw; this stays as the fallback and as the parity reference.
 */
export function rawFromSnapshot(
  snapshot: CatalogSnapshot,
  options: CatalogQueryOptions,
): CatalogRaw {
  const scope = options.scope && options.scope !== "all" ? options.scope : null;

  let base = snapshot.products;
  let collectionOrder: string[] | null = null;

  if (scope && snapshot.collectionIds[scope]) {
    const set = snapshot.collectionIds[scope];
    collectionOrder = [...set];
    base = snapshot.products.filter((p) => set.has(p.id));
  }

  const priceBounds = (() => {
    if (base.length === 0) return { min: 0, max: 0 };
    const prices = base.map(productMinPrice);
    return {
      min: Math.floor(Math.min(...prices)),
      max: Math.ceil(Math.max(...prices)),
    };
  })();

  const filtered = base.filter((p) => matchesFilters(p, options.filters));
  const sorted = sortProducts(
    filtered,
    options.sort,
    snapshot.bestSellingOrder,
    collectionOrder,
  );

  const page = Math.max(1, options.page ?? 1);
  const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const start = (page - 1) * PAGE_SIZE;

  const forSale = applyExcept(base, options.filters, ["sale"]);
  const forAvail = applyExcept(base, options.filters, ["available"]);

  return {
    products: sorted.slice(start, start + PAGE_SIZE),
    total: sorted.length,
    page,
    pageCount,
    hasNextPage: page < pageCount,
    priceBounds,
    hasBestSelling: snapshot.bestSellingOrder.length > 0,
    facets: {
      brand: countFacet(applyExcept(base, options.filters, ["brand"]), brandKeys),
      type: countFacet(applyExcept(base, options.filters, ["type"]), typeKeys),
      gender: countFacet(applyExcept(base, options.filters, ["gender"]), genderKeys),
      size: countFacet(applyExcept(base, options.filters, ["size"]), sizeKeys),
      color: countFacet(applyExcept(base, options.filters, ["color"]), colorKeys),
      saleCount: forSale.filter(productIsOnSale).length,
      saleBase: forSale.length,
      inStock: forAvail.filter(productIsAvailable).length,
      outOfStock: forAvail.filter((p) => !productIsAvailable(p)).length,
    },
    baseDistinct: {
      brand: countFacet(base, brandKeys).length,
      type: countFacet(base, typeKeys).length,
      gender: countFacet(base, genderKeys).length,
      size: countFacet(base, sizeKeys).length,
      color: countFacet(base, colorKeys).length,
    },
  };
}

/** Turns catalog data (from the snapshot or the backend) into what the UI shows. */
export function assembleResult(
  raw: CatalogRaw,
  options: Pick<CatalogQueryOptions, "scope" | "sort">,
): CatalogQueryResult {
  const scope = options.scope && options.scope !== "all" ? options.scope : null;
  const hideGenderFacet =
    scope === "men" || scope === "women" || scope === "kids";

  const brandValues = [...raw.facets.brand].sort((a, b) => {
    const pa = preferredBrands.findIndex((x) => eqi(x, a.value));
    const pb = preferredBrands.findIndex((x) => eqi(x, b.value));
    if (pa !== -1 || pb !== -1) {
      return (pa === -1 ? 99 : pa) - (pb === -1 ? 99 : pb);
    }
    return a.label.localeCompare(b.label);
  });

  const typeValues = [...raw.facets.type].sort((a, b) => a.label.localeCompare(b.label));

  const genderValues = [...raw.facets.gender].sort((a, b) => {
    const order = ["Men", "Women", "Kids", "Unisex"];
    return (
      order.findIndex((x) => eqi(x, a.value)) -
      order.findIndex((x) => eqi(x, b.value))
    );
  });

  const sizeValues = [...raw.facets.size].sort((a, b) => compareSizes(a.value, b.value));

  const colorValues = [...raw.facets.color].sort((a, b) => a.label.localeCompare(b.label));

  const { saleCount, saleBase, inStock, outOfStock } = raw.facets;

  // Show facet only when the base scope has more than one possible value.
  const facetsClean: FacetGroup[] = [];
  if (raw.baseDistinct.brand > 1 && brandValues.length > 0) {
    facetsClean.push({ id: "brand", label: "Brand", values: brandValues });
  }
  if (raw.baseDistinct.type > 1 && typeValues.length > 0) {
    facetsClean.push({ id: "type", label: "Category", values: typeValues });
  }
  if (!hideGenderFacet && raw.baseDistinct.gender > 1 && genderValues.length > 0) {
    facetsClean.push({ id: "gender", label: "Gender", values: genderValues });
  }
  if (raw.baseDistinct.size > 1 && sizeValues.length > 0) {
    facetsClean.push({ id: "size", label: "Size", values: sizeValues });
  }
  if (raw.baseDistinct.color > 1 && colorValues.length > 0) {
    facetsClean.push({ id: "color", label: "Color", values: colorValues });
  }

  // Shown when some products are on sale and some aren't.
  if (saleCount > 0 && saleBase > saleCount) {
    facetsClean.push({
      id: "sale",
      label: "On sale",
      values: [{ value: "1", label: "On sale", count: saleCount }],
    });
  }

  const availValues: FacetValue[] = [];
  if (inStock > 0) {
    availValues.push({ value: "1", label: "In stock", count: inStock });
  }
  if (outOfStock > 0) {
    availValues.push({ value: "0", label: "Out of stock", count: outOfStock });
  }
  if (availValues.length > 1) {
    facetsClean.push({
      id: "available",
      label: "Availability",
      values: availValues,
    });
  }

  const sortOptions: { value: CatalogSort; label: string }[] = [
    { value: "featured", label: "Featured" },
    { value: "latest", label: "Latest" },
    { value: "price-asc", label: "Price: Low to High" },
    { value: "price-desc", label: "Price: High to Low" },
    { value: "name-asc", label: "Name: A–Z" },
    { value: "name-desc", label: "Name: Z–A" },
  ];
  if (raw.hasBestSelling) {
    sortOptions.push({ value: "best-selling", label: "Best selling" });
  }

  return {
    products: raw.products,
    total: raw.total,
    page: raw.page,
    pageCount: raw.pageCount,
    hasNextPage: raw.hasNextPage,
    facets: facetsClean,
    priceBounds: raw.priceBounds,
    sort: options.sort,
    sortOptions,
    hideGenderFacet,
  };
}

export function filtersToSearchParams(
  filters: CatalogFilters,
  sort: CatalogSort,
  extra?: Record<string, string | null | undefined>,
): URLSearchParams {
  const p = new URLSearchParams();
  if (sort !== "featured") p.set("sort", sort);
  for (const b of filters.brand) p.append("brand", b);
  for (const t of filters.type) p.append("type", t);
  for (const g of filters.gender) p.append("gender", g);
  for (const s of filters.size) p.append("size", s);
  for (const c of filters.color) p.append("color", c);
  if (filters.sale) p.set("sale", "1");
  if (filters.available === true) p.set("available", "1");
  if (filters.available === false) p.set("available", "0");
  if (filters.priceMin !== null) p.set("price_min", String(filters.priceMin));
  if (filters.priceMax !== null) p.set("price_max", String(filters.priceMax));
  if (extra) {
    for (const [k, v] of Object.entries(extra)) {
      if (v) p.set(k, v);
    }
  }
  return p;
}
