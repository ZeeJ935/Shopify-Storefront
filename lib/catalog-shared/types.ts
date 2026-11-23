// Shared with the backend (backend/src/catalog-shared/ is an identical copy: npm run sync:shared).
// Pure types: the product shape the storefront renders and the catalog query contract.

export type ShopifyImage = {
  url: string;
  altText: string | null;
};

export type MoneyValue = {
  amount: string;
  currencyCode: string;
};

export type ProductVariant = {
  id: string;
  title: string;
  availableForSale: boolean;
  /** Stock fields are only fetched for the product page. */
  quantityAvailable?: number | null;
  currentlyNotInStock?: boolean;
  price: MoneyValue;
  compareAtPrice: MoneyValue | null;
  selectedOptions: {
    name: string;
    value: string;
  }[];
};

export type ProductListItem = {
  id: string;
  title: string;
  handle: string;
  description: string;
  productType: string;
  vendor: string;
  tags: string[];
  availableForSale: boolean;
  featuredImage: ShopifyImage | null;
  images: ShopifyImage[];
  priceRange: {
    minVariantPrice: MoneyValue;
  };
  compareAtPrice: MoneyValue | null;
  variants: ProductVariant[];
  createdAt?: string;
};

/** A product node as the Storefront API returns it for PRODUCT_CARD_FIELDS. */
export type ProductNode = {
  id: string;
  title: string;
  handle: string;
  description: string;
  productType: string;
  vendor: string;
  tags: string[];
  availableForSale: boolean;
  createdAt?: string;
  featuredImage: ShopifyImage | null;
  images: { edges: { node: ShopifyImage }[] };
  priceRange: { minVariantPrice: MoneyValue };
  variants: {
    edges: {
      node: {
        id: string;
        title: string;
        availableForSale: boolean;
        quantityAvailable?: number | null;
        currentlyNotInStock?: boolean;
        price: MoneyValue;
        compareAtPrice: MoneyValue | null;
        selectedOptions: { name: string; value: string }[];
      };
    }[];
  };
};

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

/**
 * The data part of a catalog query: products for the page, totals, and facet
 * counts. Produced by the old in-memory snapshot or by the backend's SQL; the
 * app turns it into the UI result (facet order and visibility, sort options).
 */
export type CatalogRaw = {
  products: ProductListItem[];
  total: number;
  page: number;
  pageCount: number;
  hasNextPage: boolean;
  priceBounds: { min: number; max: number };
  /** True when a best-selling order exists (the "Best selling" sort is offered). */
  hasBestSelling: boolean;
  /** Each group counted over the scope with every filter applied except its own; in first-seen order. */
  facets: {
    brand: FacetValue[];
    type: FacetValue[];
    gender: FacetValue[];
    size: FacetValue[];
    color: FacetValue[];
    /** Products on sale / total, with every filter except "sale". */
    saleCount: number;
    saleBase: number;
    /** In stock / out of stock, with every filter except "available". */
    inStock: number;
    outOfStock: number;
  };
  /** Distinct values per group in the whole scope (no filters): a group shows only when > 1. */
  baseDistinct: { brand: number; type: number; gender: number; size: number; color: number };
};
