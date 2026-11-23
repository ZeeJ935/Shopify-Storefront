import { mapProductNode, PRODUCT_CARD_FIELDS } from "../catalog-shared/product-map.js";
import type { ProductListItem, ProductNode } from "../catalog-shared/types.js";

const API_VERSION = "2026-10";

export type FetchedProduct = { item: ProductListItem; updatedAt: string | null };

/** The Storefront API reads catalog sync needs. Tests pass a fake. */
export type CatalogSource = {
  /** One product by GID, or null when it doesn't exist or isn't published to the storefront. */
  product(id: string): Promise<(FetchedProduct & { collections: string[] }) | null>;
  /** One page of the whole catalog, in Shopify's default order. */
  productsPage(after: string | null): Promise<{ products: FetchedProduct[]; endCursor: string | null; hasNextPage: boolean }>;
  /** Up to 250 product IDs in best-selling order. */
  bestSellingIds(): Promise<string[]>;
  /** All product IDs in one collection, in its order; [] when the collection doesn't exist. */
  collectionIds(handle: string): Promise<string[]>;
};

type NodeWithUpdated = ProductNode & { updatedAt?: string | null };

export function createStorefrontSource({ storeDomain, token, timeoutMs = 20_000 }: { storeDomain: string; token: string; timeoutMs?: number }): CatalogSource {
  async function gql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    const response = await fetch(`https://${storeDomain}/api/${API_VERSION}/graphql.json`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-shopify-storefront-access-token": token },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) throw new Error(`Storefront API returned ${response.status}`);
    const json = (await response.json()) as { data?: T; errors?: { message: string }[] };
    if (json.errors?.length) throw new Error(`Storefront API: ${json.errors.map((e) => e.message).join("; ").slice(0, 300)}`);
    if (!json.data) throw new Error("Storefront API returned no data");
    return json.data;
  }

  const fetched = (node: NodeWithUpdated): FetchedProduct => ({ item: mapProductNode(node), updatedAt: node.updatedAt ?? null });

  return {
    async product(id) {
      const data = await gql<{ node: (NodeWithUpdated & { collections?: { nodes: { handle: string }[] } }) | null }>(
        `query CatalogProduct($id: ID!) {
          node(id: $id) { ... on Product { ${PRODUCT_CARD_FIELDS} updatedAt collections(first: 50) { nodes { handle } } } }
        }`,
        { id },
      );
      const node = data.node;
      if (!node || !("handle" in node) || !node.handle) return null;
      return { ...fetched(node), collections: node.collections?.nodes.map((c) => c.handle) ?? [] };
    },
    async productsPage(after) {
      const data = await gql<{
        products: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: NodeWithUpdated[] };
      }>(
        `query CatalogPage($after: String) {
          products(first: 100, after: $after) { pageInfo { hasNextPage endCursor } nodes { ${PRODUCT_CARD_FIELDS} updatedAt } }
        }`,
        { after },
      );
      return {
        products: data.products.nodes.map(fetched),
        endCursor: data.products.pageInfo.endCursor,
        hasNextPage: data.products.pageInfo.hasNextPage,
      };
    },
    async bestSellingIds() {
      const data = await gql<{ products: { nodes: { id: string }[] } }>(
        `query CatalogBestSelling { products(first: 250, sortKey: BEST_SELLING) { nodes { id } } }`,
        {},
      );
      return data.products.nodes.map((n) => n.id);
    },
    async collectionIds(handle) {
      const ids: string[] = [];
      let after: string | null = null;
      for (;;) {
        const data: {
          collection: { products: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: { id: string }[] } } | null;
        } = await gql(
          `query CatalogCollection($handle: String!, $after: String) {
            collection(handle: $handle) { products(first: 100, after: $after) { pageInfo { hasNextPage endCursor } nodes { id } } }
          }`,
          { handle, after },
        );
        if (!data.collection) return ids;
        ids.push(...data.collection.products.nodes.map((n) => n.id));
        if (!data.collection.products.pageInfo.hasNextPage) return ids;
        after = data.collection.products.pageInfo.endCursor;
      }
    },
  };
}
