import "server-only";
import type { Cart } from "./cart";
import { offerHint, parseOffers, type HintLine, type OfferHint, type PublicOffer } from "./offer-hint";
import { shopifyFetch } from "./shopify";
import { maxPurchasable } from "./stock";

/**
 * zj-discount-engine publishes its live Buy X Get Y offers to a shop metafield
 * ($app:public_offers, Storefront public read). The Storefront API addresses an app's
 * $app namespace as app--<app id>; override with SHOPIFY_OFFERS_NAMESPACE.
 */
const DEFAULT_OFFERS_NAMESPACE = "app--451440410625";
const OFFERS_KEY = "public_offers";
/** Seconds. Offers change rarely; dates are re-checked on every hint. */
const OFFERS_REVALIDATE = 300;

export async function getPublicOffers(): Promise<PublicOffer[]> {
  const namespace = process.env.SHOPIFY_OFFERS_NAMESPACE?.trim() || DEFAULT_OFFERS_NAMESPACE;
  const data = await shopifyFetch<{ shop: { metafield: { value: string } | null } }>(
    `query PublicOffers($namespace: String!, $key: String!) {
      shop { metafield(namespace: $namespace, key: $key) { value } }
    }`,
    { namespace, key: OFFERS_KEY },
    { revalidate: OFFERS_REVALIDATE },
  );
  return parseOffers(data.shop.metafield?.value);
}

/** Collection ids per product, for COLLECTIONS targets only (one cached request). */
async function productCollections(productIds: string[]): Promise<Map<string, string[]>> {
  if (productIds.length === 0) return new Map();
  const data = await shopifyFetch<{ nodes: ({ id: string; collections: { nodes: { id: string }[] } } | null)[] }>(
    `query ProductCollections($ids: [ID!]!) {
      nodes(ids: $ids) {
        ... on Product { id collections(first: 50) { nodes { id } } }
      }
    }`,
    { ids: [...productIds].sort() },
    { revalidate: OFFERS_REVALIDATE },
  );
  return new Map(data.nodes.flatMap((n) => (n?.id ? [[n.id, n.collections.nodes.map((c) => c.id)]] : [])));
}

/** The bag prompt for this cart, or null. */
export async function getOfferHint(cart: Cart, nowMs = Date.now()): Promise<OfferHint | null> {
  const offers = await getPublicOffers();
  if (offers.length === 0 || cart.lines.length === 0) return null;

  const productIds = [...new Set(cart.lines.map((l) => l.merchandise.product.id))];
  const collections = offers.some((o) => o.target.kind === "COLLECTIONS")
    ? await productCollections(productIds)
    : new Map<string, string[]>();

  const lines: HintLine[] = cart.lines.map((l) => ({
    productId: l.merchandise.product.id,
    collectionIds: collections.get(l.merchandise.product.id) ?? [],
    variantId: l.merchandise.id,
    title: l.merchandise.product.title,
    quantity: l.quantity,
    unitPrice: Number(l.cost.amountPerQuantity.amount),
    maxQuantity: maxPurchasable(l.merchandise),
  }));
  return offerHint(offers, lines, nowMs);
}
