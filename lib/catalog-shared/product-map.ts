// Shared with the backend (backend/src/catalog-shared/ is an identical copy: npm run sync:shared).
// Storefront fields for product cards and the normalization the storefront renders.
import type { ProductListItem, ProductNode } from "./types.js";

export const VARIANT_FIELDS = `
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

export const PRODUCT_CARD_FIELDS = `
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

export function mapProductNode(node: ProductNode): ProductListItem {
  const variants = node.variants.edges.map((e) => e.node);
  // Cards show the cheapest price, so the "was" price must belong to a variant
  // at that same price; otherwise a sale on a pricier variant fakes a discount.
  const minPrice = Number(node.priceRange.minVariantPrice.amount);
  const compareAt =
    variants.find(
      (v) =>
        Number(v.price.amount) === minPrice &&
        v.compareAtPrice &&
        Number(v.compareAtPrice.amount) > minPrice,
    )?.compareAtPrice ?? null;

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
