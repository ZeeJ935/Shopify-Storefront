import {
  getCatalogSnapshot,
  productIsAvailable,
  productIsOnSale,
  productMinPrice,
  productSizeValues,
} from "./catalog-snapshot";
import {
  genderTagsFromProduct,
  primaryColorTag,
} from "./tag-classify";
import type { ProductListItem } from "./products";
import { preferredBrands } from "./site-content";

export const PAGE_SIZE = 24;

export type CatalogSort =
  | "featured"
  | "latest"
  | "price-asc"
  | "price-desc"
  | "name-asc"
  | "name-desc"
  | "best-selling";

export type CatalogFilters = {
  brand: string[];
  type: string[];
  gender: string[];
  size: string[];
  color: string[];
  sale: boolean | null;
  available: boolean | null;
  priceMin: number | null;
  priceMax: number | null;
};

export type FacetValue = {
  value: string;
  label: string;
  count: number;
};

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

function compareSizes(a: string, b: string): number {
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

export async function queryCatalog(options: {
  scope?: string | null;
  filters: CatalogFilters;
  sort: CatalogSort;
  page?: number;
}): Promise<CatalogQueryResult> {
  const snapshot = await getCatalogSnapshot();
  const scope = options.scope && options.scope !== "all" ? options.scope : null;

  let base = snapshot.products;
  let collectionOrder: string[] | null = null;

  if (scope && snapshot.collectionIds[scope]) {
    const set = snapshot.collectionIds[scope];
    collectionOrder = [...set];
    base = snapshot.products.filter((p) => set.has(p.id));
  }

  const hideGenderFacet =
    scope === "men" || scope === "women" || scope === "kids";

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
  const products = sorted.slice(start, start + PAGE_SIZE);

  const forBrand = applyExcept(base, options.filters, ["brand"]);
  const forType = applyExcept(base, options.filters, ["type"]);
  const forGender = applyExcept(base, options.filters, ["gender"]);
  const forSize = applyExcept(base, options.filters, ["size"]);
  const forColor = applyExcept(base, options.filters, ["color"]);
  const forSale = applyExcept(base, options.filters, ["sale"]);
  const forAvail = applyExcept(base, options.filters, ["available"]);

  const brandValues = countFacet(forBrand, (p) => [p.vendor]).sort((a, b) => {
    const pa = preferredBrands.findIndex((x) => eqi(x, a.value));
    const pb = preferredBrands.findIndex((x) => eqi(x, b.value));
    if (pa !== -1 || pb !== -1) {
      return (pa === -1 ? 99 : pa) - (pb === -1 ? 99 : pb);
    }
    return a.label.localeCompare(b.label);
  });

  const typeValues = countFacet(forType, (p) =>
    p.productType ? [p.productType] : [],
  ).sort((a, b) => a.label.localeCompare(b.label));

  const genderValues = countFacet(forGender, (p) =>
    genderTagsFromProduct(p.tags),
  ).sort((a, b) => {
    const order = ["Men", "Women", "Kids", "Unisex"];
    return (
      order.findIndex((x) => eqi(x, a.value)) -
      order.findIndex((x) => eqi(x, b.value))
    );
  });

  const sizeValues = countFacet(forSize, (p) => productSizeValues(p)).sort(
    (a, b) => compareSizes(a.value, b.value),
  );

  const colorValues = countFacet(forColor, (p) => {
    const c = primaryColorTag(p.tags);
    return c ? [c] : [];
  }).sort((a, b) => a.label.localeCompare(b.label));

  const onSaleCount = forSale.filter(productIsOnSale).length;
  const inStockCount = forAvail.filter(productIsAvailable).length;
  const oosCount = forAvail.filter((p) => !productIsAvailable(p)).length;

  // Show facet only when the base scope has more than one possible value.
  const facetsClean: FacetGroup[] = [];
  const brandInBase = countFacet(base, (p) => [p.vendor]);
  if (brandInBase.length > 1 && brandValues.length > 0) {
    facetsClean.push({ id: "brand", label: "Brand", values: brandValues });
  }

  const typeInBase = countFacet(base, (p) =>
    p.productType ? [p.productType] : [],
  );
  if (typeInBase.length > 1 && typeValues.length > 0) {
    facetsClean.push({ id: "type", label: "Category", values: typeValues });
  }

  if (!hideGenderFacet) {
    const genderInBase = countFacet(base, (p) => genderTagsFromProduct(p.tags));
    if (genderInBase.length > 1 && genderValues.length > 0) {
      facetsClean.push({ id: "gender", label: "Gender", values: genderValues });
    }
  }

  const sizeInBase = countFacet(base, (p) => productSizeValues(p));
  if (sizeInBase.length > 1 && sizeValues.length > 0) {
    facetsClean.push({ id: "size", label: "Size", values: sizeValues });
  }

  const colorInBase = countFacet(base, (p) => {
    const c = primaryColorTag(p.tags);
    return c ? [c] : [];
  });
  if (colorInBase.length > 1 && colorValues.length > 0) {
    facetsClean.push({ id: "color", label: "Color", values: colorValues });
  }

  if (onSaleCount > 0 && forSale.some((p) => !productIsOnSale(p))) {
    facetsClean.push({
      id: "sale",
      label: "On sale",
      values: [{ value: "1", label: "On sale", count: onSaleCount }],
    });
  }

  const availValues: FacetValue[] = [];
  if (inStockCount > 0) {
    availValues.push({ value: "1", label: "In stock", count: inStockCount });
  }
  if (oosCount > 0) {
    availValues.push({ value: "0", label: "Out of stock", count: oosCount });
  }
  if (availValues.length > 1) {
    facetsClean.push({
      id: "available",
      label: "Availability",
      values: availValues,
    });
  }

  const hasBestSelling = snapshot.bestSellingOrder.length > 0;
  const sortOptions: { value: CatalogSort; label: string }[] = [
    { value: "featured", label: "Featured" },
    { value: "latest", label: "Latest" },
    { value: "price-asc", label: "Price: Low to High" },
    { value: "price-desc", label: "Price: High to Low" },
    { value: "name-asc", label: "Name: A–Z" },
    { value: "name-desc", label: "Name: Z–A" },
  ];
  if (hasBestSelling) {
    sortOptions.push({ value: "best-selling", label: "Best selling" });
  }

  return {
    products,
    total: sorted.length,
    page,
    pageCount,
    hasNextPage: page < pageCount,
    facets: facetsClean,
    priceBounds,
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
