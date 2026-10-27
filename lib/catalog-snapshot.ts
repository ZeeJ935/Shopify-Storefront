/**
 * Full-catalog snapshot for in-app filter/sort/pagination.
 * Suitable for ~hundreds of products. If the catalog grows into the thousands,
 * move filtering to Storefront API `filters` / search instead of loading all nodes.
 */

import { CATALOG_REVALIDATE, shopifyFetch } from "./shopify";
import {
  mapProductNode,
  PRODUCT_CARD_FIELDS,
  type ProductListItem,
  type ProductNode,
} from "./products";

export type CatalogSnapshot = {
  products: ProductListItem[];
  /** Product IDs in each known collection (membership). */
  collectionIds: Record<string, Set<string>>;
  /** Best-selling order from products(sortKey: BEST_SELLING) when available. */
  bestSellingOrder: string[];
};

const COLLECTION_HANDLES = [
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

async function fetchAllProducts(): Promise<ProductListItem[]> {
  const products: ProductListItem[] = [];
  let after: string | null = null;
  let hasNext = true;

  while (hasNext) {
    const data: {
      products: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
        edges: { node: ProductNode }[];
      };
    } = await shopifyFetch(
      `
      query SnapshotProducts($after: String) {
        products(first: 100, after: $after) {
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
    `,
      { after },
      { revalidate: CATALOG_REVALIDATE },
    );

    for (const edge of data.products.edges) {
      products.push(mapProductNode(edge.node));
    }
    hasNext = data.products.pageInfo.hasNextPage;
    after = data.products.pageInfo.endCursor;
    if (!hasNext) break;
  }

  return products;
}

async function fetchBestSellingIds(): Promise<string[]> {
  try {
    const data = await shopifyFetch<{
      products: { edges: { node: { id: string } }[] };
    }>(
      `
      query BestSellingIds {
        products(first: 250, sortKey: BEST_SELLING) {
          edges { node { id } }
        }
      }
    `,
      {},
      { revalidate: CATALOG_REVALIDATE },
    );
    return data.products.edges.map((e) => e.node.id);
  } catch {
    return [];
  }
}

async function fetchCollectionProductIds(
  handle: string,
): Promise<string[]> {
  const ids: string[] = [];
  let after: string | null = null;
  let hasNext = true;

  try {
    while (hasNext) {
      const data: {
        collection: {
          products: {
            pageInfo: { hasNextPage: boolean; endCursor: string | null };
            edges: { node: { id: string } }[];
          };
        } | null;
      } = await shopifyFetch(
        `
        query CollectionIds($handle: String!, $after: String) {
          collection(handle: $handle) {
            products(first: 100, after: $after) {
              pageInfo { hasNextPage endCursor }
              edges { node { id } }
            }
          }
        }
      `,
        { handle, after },
        { revalidate: CATALOG_REVALIDATE },
      );

      if (!data.collection) return ids;
      for (const edge of data.collection.products.edges) {
        ids.push(edge.node.id);
      }
      hasNext = data.collection.products.pageInfo.hasNextPage;
      after = data.collection.products.pageInfo.endCursor;
      if (!hasNext) break;
    }
  } catch {
    return ids;
  }

  return ids;
}

let snapshotPromise: Promise<CatalogSnapshot> | null = null;

export async function getCatalogSnapshot(): Promise<CatalogSnapshot> {
  if (!snapshotPromise) {
    snapshotPromise = (async () => {
      const [products, bestSellingOrder, ...collectionResults] =
        await Promise.all([
          fetchAllProducts(),
          fetchBestSellingIds(),
          ...COLLECTION_HANDLES.map(async (handle) => ({
            handle,
            ids: await fetchCollectionProductIds(handle),
          })),
        ]);

      const collectionIds: Record<string, Set<string>> = {};
      for (const row of collectionResults) {
        collectionIds[row.handle] = new Set(row.ids);
      }

      return {
        products,
        collectionIds,
        bestSellingOrder,
      };
    })().finally(() => {
      // Allow refresh after revalidate window by clearing memo on next tick of process —
      // Next fetch cache still applies; this only dedupes concurrent requests.
      snapshotPromise = null;
    });
  }
  return snapshotPromise;
}

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
