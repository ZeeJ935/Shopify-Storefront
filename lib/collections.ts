import { CATALOG_REVALIDATE, shopifyFetch } from "./shopify";
import {
  mapProductNode,
  PRODUCT_CARD_FIELDS,
  type ProductListItem,
  type ProductNode,
  type ShopifyImage,
} from "./products";

export type CollectionSortKey =
  | "BEST_SELLING"
  | "COLLECTION_DEFAULT"
  | "CREATED"
  | "PRICE"
  | "TITLE"
  | "MANUAL";

export type FilterValue = {
  id: string;
  label: string;
  count: number;
  input: string; // JSON stringified ProductFilter for URL round-trip
};

export type AvailableFilter = {
  id: string;
  label: string;
  type: string;
  values: FilterValue[];
};

export type CollectionResult = {
  id: string;
  handle: string;
  title: string;
  description: string;
  image: ShopifyImage | null;
  products: ProductListItem[];
  filters: AvailableFilter[];
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
};

export type ProductFilterInput = Record<string, unknown>;

export async function getCollectionByHandle(
  handle: string,
  options?: {
    first?: number;
    after?: string;
    sortKey?: CollectionSortKey;
    reverse?: boolean;
    filters?: ProductFilterInput[];
  },
): Promise<CollectionResult | null> {
  const data = await shopifyFetch<{
    collection: {
      id: string;
      handle: string;
      title: string;
      description: string;
      image: ShopifyImage | null;
      products: {
        filters: {
          id: string;
          label: string;
          type: string;
          values: {
            id: string;
            label: string;
            count: number;
            input: unknown;
          }[];
        }[];
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
        edges: { node: ProductNode }[];
      };
    } | null;
  }>(
    `
    query CollectionByHandle(
      $handle: String!
      $first: Int!
      $after: String
      $sortKey: ProductCollectionSortKeys
      $reverse: Boolean
      $filters: [ProductFilter!]
    ) {
      collection(handle: $handle) {
        id
        handle
        title
        description
        image {
          url
          altText
        }
        products(
          first: $first
          after: $after
          sortKey: $sortKey
          reverse: $reverse
          filters: $filters
        ) {
          filters {
            id
            label
            type
            values {
              id
              label
              count
              input
            }
          }
          pageInfo {
            hasNextPage
            endCursor
          }
          edges {
            node {
              ${PRODUCT_CARD_FIELDS}
            }
          }
        }
      }
    }
  `,
    {
      handle,
      first: options?.first ?? 24,
      after: options?.after ?? null,
      sortKey: options?.sortKey ?? "COLLECTION_DEFAULT",
      reverse: options?.reverse ?? false,
      filters: options?.filters?.length ? options.filters : null,
    },
    { revalidate: CATALOG_REVALIDATE },
  );

  if (!data.collection) return null;

  return {
    id: data.collection.id,
    handle: data.collection.handle,
    title: data.collection.title,
    description: data.collection.description,
    image: data.collection.image,
    products: data.collection.products.edges.map((e) =>
      mapProductNode(e.node),
    ),
    filters: (data.collection.products.filters ?? []).map((f) => ({
      id: f.id,
      label: f.label,
      type: f.type,
      values: f.values.map((v) => ({
        id: v.id,
        label: v.label,
        count: v.count,
        input:
          typeof v.input === "string" ? v.input : JSON.stringify(v.input ?? {}),
      })),
    })),
    pageInfo: data.collection.products.pageInfo,
  };
}

export async function getCollectionsIndex(first = 50): Promise<
  {
    handle: string;
    title: string;
    description: string;
    image: ShopifyImage | null;
    productCountHint: number;
  }[]
> {
  const data = await shopifyFetch<{
    collections: {
      edges: {
        node: {
          handle: string;
          title: string;
          description: string;
          image: ShopifyImage | null;
          products: { edges: { node: { id: string } }[] };
        };
      }[];
    };
  }>(
    `
    query CollectionsIndex($first: Int!) {
      collections(first: $first, sortKey: TITLE) {
        edges {
          node {
            handle
            title
            description
            image { url altText }
            products(first: 1) {
              edges { node { id } }
            }
          }
        }
      }
    }
  `,
    { first },
    { revalidate: CATALOG_REVALIDATE },
  );

  return data.collections.edges
    .map((e) => e.node)
    .filter((c) => c.products.edges.length > 0)
    .map((c) => ({
      handle: c.handle,
      title: c.title,
      description: c.description,
      image: c.image,
      productCountHint: c.products.edges.length,
    }));
}

export function parseSortParam(sort: string | undefined): {
  sortKey: CollectionSortKey;
  reverse: boolean;
} {
  switch (sort) {
    case "best-selling":
      return { sortKey: "BEST_SELLING", reverse: false };
    case "price-asc":
      return { sortKey: "PRICE", reverse: false };
    case "price-desc":
      return { sortKey: "PRICE", reverse: true };
    case "newest":
      return { sortKey: "CREATED", reverse: true };
    case "featured":
    default:
      return { sortKey: "COLLECTION_DEFAULT", reverse: false };
  }
}

/** Build ProductFilter inputs from URL search params (shareable). */
export function filtersFromSearchParams(
  params: URLSearchParams,
): ProductFilterInput[] {
  const filters: ProductFilterInput[] = [];

  const vendor = params.get("vendor");
  if (vendor) filters.push({ productVendor: vendor });

  const type = params.get("type");
  if (type) filters.push({ productType: type });

  const availability = params.get("availability");
  if (availability === "in-stock") filters.push({ available: true });
  if (availability === "out-of-stock") filters.push({ available: false });

  const min = params.get("minPrice");
  const max = params.get("maxPrice");
  if (min || max) {
    filters.push({
      price: {
        ...(min ? { min: Number(min) } : {}),
        ...(max ? { max: Number(max) } : {}),
      },
    });
  }

  const size = params.get("size");
  if (size) {
    filters.push({
      variantOption: { name: "Size", value: size },
    });
  }

  for (const tag of params.getAll("tag")) {
    if (tag) filters.push({ tag });
  }

  const filterJson = params.getAll("filter");
  for (const raw of filterJson) {
    try {
      const parsed = JSON.parse(raw) as ProductFilterInput;
      filters.push(parsed);
    } catch {
      /* ignore bad filter blobs */
    }
  }

  return filters;
}

export async function getCollectionProductsPreview(
  handle: string,
  first = 8,
): Promise<ProductListItem[] | null> {
  try {
    const result = await getCollectionByHandle(handle, { first });
    if (!result || result.products.length === 0) return null;
    return result.products;
  } catch {
    return null;
  }
}
