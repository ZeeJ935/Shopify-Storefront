import { CATALOG_REVALIDATE, shopifyFetch } from "./shopify";

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

export type ProductDetail = {
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
  variants: ProductVariant[];
};

const VARIANT_FIELDS = `
  id
  title
  availableForSale
  price {
    amount
    currencyCode
  }
  compareAtPrice {
    amount
    currencyCode
  }
  selectedOptions {
    name
    value
  }
`;

const PRODUCT_CARD_FIELDS = `
  id
  title
  handle
  description
  productType
  vendor
  tags
  createdAt
  availableForSale
  featuredImage {
    url
    altText
  }
  images(first: 4) {
    edges {
      node {
        url
        altText
      }
    }
  }
  priceRange {
    minVariantPrice {
      amount
      currencyCode
    }
  }
  variants(first: 30) {
    edges {
      node {
        ${VARIANT_FIELDS}
      }
    }
  }
`;

/** PDP needs more variants (sizes) than catalog cards. */
const PRODUCT_DETAIL_FIELDS = `
  id
  title
  handle
  description
  productType
  vendor
  tags
  createdAt
  availableForSale
  featuredImage {
    url
    altText
  }
  images(first: 12) {
    edges {
      node {
        url
        altText
      }
    }
  }
  priceRange {
    minVariantPrice {
      amount
      currencyCode
    }
  }
  variants(first: 100) {
    edges {
      node {
        ${VARIANT_FIELDS}
      }
    }
  }
`;

type ProductNode = {
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
        price: MoneyValue;
        compareAtPrice: MoneyValue | null;
        selectedOptions: { name: string; value: string }[];
      };
    }[];
  };
};

export function mapProductNode(node: ProductNode): ProductListItem {
  const variants = node.variants.edges.map((e) => e.node);
  const compareAt =
    variants.find(
      (v) =>
        v.compareAtPrice &&
        Number(v.compareAtPrice.amount) > Number(v.price.amount),
    )?.compareAtPrice ??
    variants[0]?.compareAtPrice ??
    null;

  return {
    id: node.id,
    title: node.title,
    handle: node.handle,
    description: node.description,
    productType: node.productType,
    vendor: node.vendor,
    tags: node.tags,
    availableForSale: node.availableForSale,
    featuredImage: node.featuredImage,
    images: node.images.edges.map((e) => e.node),
    priceRange: node.priceRange,
    compareAtPrice: compareAt,
    variants,
    createdAt: node.createdAt,
  };
}

export { primaryColorTag as colorFromTags } from "./tag-classify";

/** @deprecated Prefer tag `new` on ProductCard */
export function isNewProduct(createdAt?: string, days = 30): boolean {
  if (!createdAt) return false;
  const created = Date.parse(createdAt);
  if (Number.isNaN(created)) return false;
  return Date.now() - created < days * 24 * 60 * 60 * 1000;
}

export function salePercentOff(
  price: MoneyValue,
  compareAt: MoneyValue | null,
): number | null {
  if (!compareAt) return null;
  const p = Number(price.amount);
  const c = Number(compareAt.amount);
  if (!(c > p) || c <= 0) return null;
  return Math.round(((c - p) / c) * 100);
}

export async function getShop() {
  const data = await shopifyFetch<{
    shop: {
      name: string;
      description: string | null;
    };
  }>(
    `
    query GetShop {
      shop {
        name
        description
      }
    }
  `,
    {},
    { revalidate: CATALOG_REVALIDATE },
  );

  return data.shop;
}

export type ProductSortKey =
  | "BEST_SELLING"
  | "CREATED_AT"
  | "PRICE"
  | "TITLE"
  | "RELEVANCE";

export async function getProducts(options?: {
  first?: number;
  after?: string;
  query?: string;
  sortKey?: ProductSortKey;
  reverse?: boolean;
}): Promise<{
  products: ProductListItem[];
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
}> {
  const first = options?.first ?? 24;
  const data = await shopifyFetch<{
    products: {
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
      edges: { node: ProductNode; cursor: string }[];
    };
  }>(
    `
    query GetProducts(
      $first: Int!
      $after: String
      $query: String
      $sortKey: ProductSortKeys
      $reverse: Boolean
    ) {
      products(
        first: $first
        after: $after
        query: $query
        sortKey: $sortKey
        reverse: $reverse
      ) {
        pageInfo {
          hasNextPage
          endCursor
        }
        edges {
          cursor
          node {
            ${PRODUCT_CARD_FIELDS}
          }
        }
      }
    }
  `,
    {
      first,
      after: options?.after ?? null,
      query: options?.query ?? null,
      sortKey: options?.sortKey ?? "BEST_SELLING",
      reverse: options?.reverse ?? false,
    },
    { revalidate: CATALOG_REVALIDATE },
  );

  return {
    products: data.products.edges.map((e) => mapProductNode(e.node)),
    pageInfo: data.products.pageInfo,
  };
}

export async function getProductByHandle(
  handle: string,
): Promise<ProductDetail | null> {
  if (typeof handle !== "string" || handle.trim().length === 0) {
    return null;
  }

  const data = await shopifyFetch<{
    product: ProductNode | null;
  }>(
    `
      query GetProductByHandle($handle: String!) {
        product(handle: $handle) {
          ${PRODUCT_DETAIL_FIELDS}
        }
      }
    `,
    { handle: handle.trim() },
    { revalidate: CATALOG_REVALIDATE },
  );

  if (!data.product) {
    return null;
  }

  const mapped = mapProductNode(data.product);
  return {
    id: mapped.id,
    title: mapped.title,
    handle: mapped.handle,
    description: mapped.description,
    productType: mapped.productType,
    vendor: mapped.vendor,
    tags: mapped.tags,
    availableForSale: mapped.availableForSale,
    featuredImage: mapped.featuredImage,
    images: mapped.images,
    priceRange: mapped.priceRange,
    variants: mapped.variants,
  };
}

export async function getProductsByIds(
  ids: string[],
): Promise<ProductListItem[]> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return [];

  // Storefront nodes() accepts limited batches; chunk to stay safe.
  const chunkSize = 50;
  const products: ProductListItem[] = [];

  for (let i = 0; i < unique.length; i += chunkSize) {
    const chunk = unique.slice(i, i + chunkSize);
    const data = await shopifyFetch<{
      nodes: (ProductNode | null)[];
    }>(
      `
      query ProductsByIds($ids: [ID!]!) {
        nodes(ids: $ids) {
          ... on Product {
            ${PRODUCT_CARD_FIELDS}
          }
        }
      }
    `,
      { ids: chunk },
      { revalidate: CATALOG_REVALIDATE },
    );

    for (const node of data.nodes) {
      if (node && "handle" in node && node.handle) {
        products.push(mapProductNode(node));
      }
    }
  }

  // Preserve favourite order
  const byId = new Map(products.map((p) => [p.id, p]));
  return unique.map((id) => byId.get(id)).filter(Boolean) as ProductListItem[];
}

export { PRODUCT_CARD_FIELDS };
export type { ProductNode };
