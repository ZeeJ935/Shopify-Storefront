import { compareSizes } from "./catalog-shared/catalog-rules";
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

/** Collections whose membership the catalog knows (same list as the backend's TRACKED_COLLECTIONS). */
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

function eqi(a: string, b: string) {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** Turns the backend's catalog data into what the UI shows (facet order and visibility, sort options). */
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
