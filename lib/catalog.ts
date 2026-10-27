import { cacheLife } from "next/cache";
import { CATALOG_REVALIDATE, shopifyFetch } from "./shopify";
import { getCatalogSnapshot } from "./catalog-snapshot";
import {
  preferredBrands,
  primaryNavIntents,
  type NavIntent,
  type NavIntentId,
} from "./site-content";

export type CatalogImage = {
  url: string;
  altText: string | null;
};

export type FeaturedNavProduct = {
  handle: string;
  title: string;
  featuredImage: CatalogImage | null;
};

export type ResolvedNavLink = {
  id: NavIntentId;
  label: string;
  href: string;
  megaMenu: boolean;
  collectionHandle: string | null;
  productType: string | null;
  featuredProducts: FeaturedNavProduct[];
};

export type ProductTypeTile = {
  productType: string;
  href: string;
  sampleImage: CatalogImage | null;
  sampleTitle: string | null;
};

export type BrandTile = {
  label: string;
  href: string;
  handle: string | null;
  vendor: string | null;
  sampleImage: CatalogImage | null;
};

type CollectionProbe = {
  handle: string;
  title: string;
  image: CatalogImage | null;
  products: {
    edges: {
      node: {
        handle: string;
        title: string;
        featuredImage: CatalogImage | null;
      };
    }[];
  };
} | null;

const KNOWN_HANDLES = [
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

async function probeCollections(): Promise<Map<string, CollectionProbe>> {
  const data = await shopifyFetch<{
    men: CollectionProbe;
    women: CollectionProbe;
    kids: CollectionProbe;
    nike: CollectionProbe;
    adidas: CollectionProbe;
    sale: CollectionProbe;
    trending: CollectionProbe;
    shoes: CollectionProbe;
    clothing: CollectionProbe;
    accessories: CollectionProbe;
  }>(
    `
    query ProbeCollections {
      men: collection(handle: "men") {
        handle title
        image { url altText }
        products(first: 2) {
          edges { node { handle title featuredImage { url altText } } }
        }
      }
      women: collection(handle: "women") {
        handle title
        image { url altText }
        products(first: 2) {
          edges { node { handle title featuredImage { url altText } } }
        }
      }
      kids: collection(handle: "kids") {
        handle title
        image { url altText }
        products(first: 2) {
          edges { node { handle title featuredImage { url altText } } }
        }
      }
      nike: collection(handle: "nike") {
        handle title
        image { url altText }
        products(first: 2) {
          edges { node { handle title featuredImage { url altText } } }
        }
      }
      adidas: collection(handle: "adidas") {
        handle title
        image { url altText }
        products(first: 2) {
          edges { node { handle title featuredImage { url altText } } }
        }
      }
      sale: collection(handle: "sale") {
        handle title
        image { url altText }
        products(first: 2) {
          edges { node { handle title featuredImage { url altText } } }
        }
      }
      trending: collection(handle: "trending") {
        handle title
        image { url altText }
        products(first: 2) {
          edges { node { handle title featuredImage { url altText } } }
        }
      }
      shoes: collection(handle: "shoes") {
        handle title
        image { url altText }
        products(first: 2) {
          edges { node { handle title featuredImage { url altText } } }
        }
      }
      clothing: collection(handle: "clothing") {
        handle title
        image { url altText }
        products(first: 2) {
          edges { node { handle title featuredImage { url altText } } }
        }
      }
      accessories: collection(handle: "accessories") {
        handle title
        image { url altText }
        products(first: 2) {
          edges { node { handle title featuredImage { url altText } } }
        }
      }
    }
  `,
    {},
    { revalidate: CATALOG_REVALIDATE },
  );

  const map = new Map<string, CollectionProbe>();
  for (const handle of KNOWN_HANDLES) {
    map.set(handle, data[handle] ?? null);
  }
  return map;
}

function collectionHasProducts(
  c: CollectionProbe | undefined,
): c is NonNullable<CollectionProbe> {
  return Boolean(c && c.products.edges.length > 0);
}

function typeHref(productType: string) {
  return `/collections/all?type=${encodeURIComponent(productType)}`;
}

function brandHref(
  brand: string,
  collections: Map<string, CollectionProbe>,
): string {
  const handle = brand.toLowerCase();
  const col = collections.get(handle);
  if (collectionHasProducts(col)) {
    return `/collections/${handle}`;
  }
  return `/collections/all?brand=${encodeURIComponent(brand)}`;
}

function resolveIntentHref(
  intent: NavIntent,
  collections: Map<string, CollectionProbe>,
  typeAvailable: Set<string>,
): string | null {
  if (intent.catalog) {
    return "/collections/all";
  }

  if (intent.collectionHandle) {
    const c = collections.get(intent.collectionHandle) ?? null;
    if (collectionHasProducts(c)) {
      return `/collections/${intent.collectionHandle}`;
    }
  }

  if (intent.productType && typeAvailable.has(intent.productType)) {
    return typeHref(intent.productType);
  }

  return null;
}

async function probeProductTypes(): Promise<{
  available: Set<string>;
  tiles: ProductTypeTile[];
}> {
  const types = ["Shoes", "Clothing", "Accessories"] as const;
  const results = await Promise.all(
    types.map(async (productType) => {
      try {
        const data = await shopifyFetch<{
          products: {
            edges: {
              node: {
                title: string;
                featuredImage: CatalogImage | null;
              };
            }[];
          };
        }>(
          `
          query ProductTypeSample($query: String!) {
            products(first: 1, query: $query) {
              edges {
                node {
                  title
                  featuredImage { url altText }
                }
              }
            }
          }
        `,
          { query: `product_type:${productType}` },
          { revalidate: CATALOG_REVALIDATE },
        );
        const node = data.products.edges[0]?.node;
        return {
          productType,
          has: Boolean(node),
          sampleImage: node?.featuredImage ?? null,
          sampleTitle: node?.title ?? null,
        };
      } catch {
        return {
          productType,
          has: false,
          sampleImage: null,
          sampleTitle: null,
        };
      }
    }),
  );

  const available = new Set<string>();
  const tiles: ProductTypeTile[] = [];
  for (const row of results) {
    if (!row.has) continue;
    available.add(row.productType);
    tiles.push({
      productType: row.productType,
      href: typeHref(row.productType),
      sampleImage: row.sampleImage,
      sampleTitle: row.sampleTitle,
    });
  }
  return { available, tiles };
}

export type NavCatalog = {
  links: ResolvedNavLink[];
  productTypeTiles: ProductTypeTile[];
  brandTiles: BrandTile[];
  collections: Map<string, NonNullable<CollectionProbe>>;
};

export async function getNavCatalog(): Promise<NavCatalog> {
  "use cache";
  cacheLife("minutes");

  try {
    const [collections, typeProbe, snapshot] = await Promise.all([
      probeCollections(),
      probeProductTypes(),
      getCatalogSnapshot(),
    ]);

    const populated = new Map<string, NonNullable<CollectionProbe>>();
    for (const [handle, c] of collections) {
      if (c && collectionHasProducts(c)) {
        populated.set(handle, c);
      }
    }

    const links: ResolvedNavLink[] = [];
    for (const intent of primaryNavIntents) {
      const href = resolveIntentHref(
        intent,
        collections,
        typeProbe.available,
      );
      if (!href) continue;

      const handle = intent.collectionHandle ?? null;
      const collection =
        handle && collectionHasProducts(collections.get(handle) ?? null)
          ? collections.get(handle)
          : null;

      links.push({
        id: intent.id,
        label: intent.label,
        href,
        megaMenu: Boolean(intent.megaMenu),
        collectionHandle: collection?.handle ?? null,
        productType: intent.productType ?? null,
        featuredProducts:
          collection?.products.edges.map((e) => e.node).slice(0, 2) ?? [],
      });
    }

    // Brands from vendors + preferred Nike/Adidas (mist tile if no products yet).
    const newestByVendor = new Map<
      string,
      { image: CatalogImage | null; createdAt: string }
    >();
    for (const p of snapshot.products) {
      const key = p.vendor.trim().toLowerCase();
      if (!key) continue;
      const created = p.createdAt ?? "";
      const prev = newestByVendor.get(key);
      if (!prev || created > prev.createdAt) {
        newestByVendor.set(key, {
          image: p.featuredImage ?? p.images[0] ?? null,
          createdAt: created,
        });
      }
    }

    const brandTiles: BrandTile[] = [];
    const seen = new Set<string>();
    for (const brand of preferredBrands) {
      const key = brand.toLowerCase();
      seen.add(key);
      const fromVendor = newestByVendor.get(key);
      brandTiles.push({
        label: brand,
        href: brandHref(brand, collections),
        handle: collectionHasProducts(collections.get(key)) ? key : null,
        vendor: brand,
        sampleImage: fromVendor?.image ?? null,
      });
    }
    for (const [key, info] of newestByVendor) {
      if (seen.has(key)) continue;
      const label =
        snapshot.products.find((p) => p.vendor.toLowerCase() === key)?.vendor ??
        key;
      brandTiles.push({
        label,
        href: brandHref(label, collections),
        handle: collectionHasProducts(collections.get(key)) ? key : null,
        vendor: label,
        sampleImage: info.image,
      });
    }

    return {
      links,
      productTypeTiles: typeProbe.tiles,
      brandTiles,
      collections: populated,
    };
  } catch {
    return {
      links: [],
      productTypeTiles: [],
      brandTiles: [],
      collections: new Map(),
    };
  }
}

export function collectionHref(handle: string) {
  return `/collections/${handle}`;
}

export async function getCollectionPresence(
  handle: string,
): Promise<boolean> {
  const catalog = await getNavCatalog();
  return catalog.collections.has(handle);
}
