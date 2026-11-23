// A deterministic 40-product catalog with the edge cases the catalog query must
// handle identically in memory (snapshot) and in SQL (backend): case variants,
// equal prices and titles, missing dates and best-selling ranks, sale on a
// pricier variant, duplicate sizes, empty and untracked collections.
import type { CatalogFilters, CatalogSort, ProductListItem } from "../lib/catalog-shared/types";

const VENDORS = ["Nike", "Adidas", "nike", "Puma"];
const TYPES = ["Shoes", "Clothing", "Accessories", "", "shoes"];
const GENDERS = [["Men"], ["Women"], ["Kids"], ["Unisex"], ["men", "Women"], []];
const COLORS = [["Black"], ["white"], ["Red", "Blue"], [], ["black"]];
const SIZE_SETS = [["S", "M", "L"], ["9", "10", "10.5"], ["XL", "M"], [], ["One Size"], ["m", "L"]];
const TITLES = ["Alpha", "alpha", "Ålpha", "Beta", " Gamma ", "delta", "Delta", "epsilon"];
const PRICES = ["50.0", "50.00", "19.99", "120", "75.5", "0", "250", "33"];

const money = (amount: string) => ({ amount, currencyCode: "USD" });

export function fixtureProducts(): ProductListItem[] {
  const products: ProductListItem[] = [];
  for (let i = 0; i < 40; i++) {
    const price = PRICES[i % PRICES.length];
    const sizes = SIZE_SETS[i % SIZE_SETS.length];
    const onSale = i % 5 === 0;
    // Every 7th product: the sale is on a pricier variant, so the card is NOT on sale.
    const pricierSale = i % 7 === 3;
    const variants = (sizes.length ? sizes : ["Default"]).map((size, v) => {
      const variantPrice = pricierSale && v === 1 ? String(Number(price) + 10) : price;
      const compareAt =
        onSale && v === 0 ? money(String(Number(price) + 20)) : pricierSale && v === 1 ? money(String(Number(price) + 30)) : null;
      return {
        id: `gid://shopify/ProductVariant/${i}${v}`,
        title: size,
        availableForSale: i % 6 !== 4,
        price: money(variantPrice),
        compareAtPrice: compareAt,
        // Variant option names vary in case; duplicates within a product are allowed.
        selectedOptions: sizes.length ? [{ name: i % 2 ? "Size" : "size", value: size }] : [{ name: "Title", value: "Default" }],
      };
    });
    const compareAtPrice = onSale ? money(String(Number(price) + 20)) : null;
    products.push({
      id: `gid://shopify/Product/${1000 + i}`,
      title: `${TITLES[i % TITLES.length]}${i % 3 === 0 ? "" : ` ${Math.floor(i / 8)}`}`,
      handle: `product-${i}`,
      description: `Fixture product ${i}`,
      productType: TYPES[i % TYPES.length],
      vendor: VENDORS[i % VENDORS.length],
      tags: [...GENDERS[i % GENDERS.length], ...COLORS[i % COLORS.length], i % 4 === 0 ? "running" : "originals"],
      availableForSale: i % 6 !== 4,
      featuredImage: { url: `https://cdn.example/${i}.jpg`, altText: null },
      images: [],
      priceRange: { minVariantPrice: money(price) },
      compareAtPrice,
      variants,
      // Some missing, some equal dates.
      createdAt: i % 9 === 0 ? undefined : `2026-0${1 + (i % 9)}-1${i % 3}T00:00:00Z`,
    });
  }
  return products;
}

export function fixtureSnapshot() {
  const products = fixtureProducts();
  const id = (i: number) => products[i].id;
  return {
    products,
    // Collection order differs from catalog order; "nike" is empty.
    collectionIds: {
      men: new Set([id(10), id(0), id(4), id(24), id(18), id(30), id(6), id(12)]),
      women: new Set([1, 4, 7, 13, 19, 25, 31, 37].map(id)),
      kids: new Set([2, 8, 14].map(id)),
      nike: new Set<string>(),
      adidas: new Set([1, 5, 9, 13, 17, 21, 25, 29, 33, 37].map(id)),
      sale: new Set([0, 5, 10, 15, 20, 25, 30, 35].map(id)),
      trending: new Set([39, 38, 1, 2].map(id)),
      shoes: new Set([0, 4, 5, 9, 10, 14, 15, 19].map(id)),
      clothing: new Set([1, 6, 11, 16].map(id)),
      accessories: new Set([2, 7, 12, 17, 22, 27, 32, 37].map(id)),
    } as Record<string, Set<string>>,
    // Best-selling covers only some products, in its own order.
    bestSellingOrder: [7, 3, 22, 0, 15, 38, 11, 29, 2, 34, 18].map(id),
  };
}

const NO_FILTERS: CatalogFilters = {
  brand: [],
  type: [],
  gender: [],
  size: [],
  color: [],
  sale: null,
  available: null,
  priceMin: null,
  priceMax: null,
};

type Input = { scope: string | null; sort: CatalogSort; page: number; filters: CatalogFilters };

/** Query inputs the old and new catalog must answer identically. */
export function fixtureInputs(): Input[] {
  const sorts: CatalogSort[] = ["featured", "latest", "price-asc", "price-desc", "name-asc", "name-desc", "best-selling"];
  const inputs: Input[] = [];
  for (const sort of sorts) {
    inputs.push({ scope: null, sort, page: 1, filters: NO_FILTERS });
    inputs.push({ scope: null, sort, page: 2, filters: NO_FILTERS });
    inputs.push({ scope: "men", sort, page: 1, filters: NO_FILTERS });
  }
  const f = (patch: Partial<CatalogFilters>) => ({ ...NO_FILTERS, ...patch });
  inputs.push(
    { scope: "all", sort: "featured", page: 1, filters: f({ brand: ["nike"] }) },
    { scope: null, sort: "price-asc", page: 1, filters: f({ brand: ["NIKE", "Puma"], type: ["shoes"] }) },
    { scope: null, sort: "name-asc", page: 1, filters: f({ gender: ["men"] }) },
    { scope: null, sort: "latest", page: 1, filters: f({ size: ["m", "10"] }) },
    { scope: null, sort: "featured", page: 1, filters: f({ color: ["BLACK"] }) },
    { scope: null, sort: "price-desc", page: 1, filters: f({ sale: true }) },
    { scope: null, sort: "featured", page: 1, filters: f({ available: false }) },
    { scope: null, sort: "featured", page: 1, filters: f({ available: true, priceMin: 20, priceMax: 100 }) },
    { scope: "sale", sort: "featured", page: 1, filters: f({ type: ["Clothing"] }) },
    { scope: "nike", sort: "featured", page: 1, filters: NO_FILTERS },
    { scope: "not-a-tracked-collection", sort: "featured", page: 1, filters: NO_FILTERS },
    { scope: "women", sort: "name-desc", page: 1, filters: f({ priceMin: 50 }) },
    { scope: null, sort: "featured", page: 3, filters: NO_FILTERS },
    { scope: null, sort: "featured", page: 1, filters: f({ brand: ["nobody"] }) },
  );
  return inputs;
}
