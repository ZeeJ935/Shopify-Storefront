import { CATALOG_REVALIDATE, shopifyFetch } from "./shopify";
import {
  mapProductNode,
  PRODUCT_CARD_FIELDS,
  type ProductListItem,
  type ProductNode,
} from "./products";

export type PredictiveResult = {
  products: ProductListItem[];
  collections: { handle: string; title: string }[];
  queries: { text: string; styledText: string }[];
};

export async function predictiveSearch(
  term: string,
): Promise<PredictiveResult> {
  const q = term.trim();
  if (!q) {
    return { products: [], collections: [], queries: [] };
  }

  const data = await shopifyFetch<{
    predictiveSearch: {
      products: ProductNode[];
      collections: { handle: string; title: string }[];
      queries: { text: string; styledText: string }[];
    };
  }>(
    `
    query PredictiveSearch($q: String!) {
      predictiveSearch(
        query: $q
        limit: 8
        limitScope: EACH
        types: [PRODUCT, COLLECTION, QUERY]
      ) {
        products {
          ${PRODUCT_CARD_FIELDS}
        }
        collections {
          handle
          title
        }
        queries {
          text
          styledText
        }
      }
    }
  `,
    { q },
    { revalidate: 60 },
  );

  return {
    products: data.predictiveSearch.products.map(mapProductNode),
    collections: data.predictiveSearch.collections,
    queries: data.predictiveSearch.queries,
  };
}

export async function searchProducts(
  term: string,
  options?: { first?: number; after?: string },
): Promise<{
  products: ProductListItem[];
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
}> {
  const q = term.trim();
  if (!q) {
    return {
      products: [],
      pageInfo: { hasNextPage: false, endCursor: null },
    };
  }

  const data = await shopifyFetch<{
    search: {
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
      edges: { node: ProductNode }[];
    };
  }>(
    `
    query SearchProducts($q: String!, $first: Int!, $after: String) {
      search(
        query: $q
        first: $first
        after: $after
        types: PRODUCT
        prefix: LAST
      ) {
        pageInfo {
          hasNextPage
          endCursor
        }
        edges {
          node {
            ... on Product {
              ${PRODUCT_CARD_FIELDS}
            }
          }
        }
      }
    }
  `,
    {
      q,
      first: options?.first ?? 24,
      after: options?.after ?? null,
    },
    { revalidate: CATALOG_REVALIDATE },
  );

  return {
    products: data.search.edges
      .map((e) => e.node)
      .filter((n): n is ProductNode => Boolean(n?.id))
      .map(mapProductNode),
    pageInfo: data.search.pageInfo,
  };
}
