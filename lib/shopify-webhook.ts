import { createHmac, timingSafeEqual } from "node:crypto";

/** Webhook topics whose changes the storefront's catalog cache must reflect. */
export const CATALOG_TOPICS: ReadonlySet<string> = new Set([
  "products/create",
  "products/update",
  "products/delete",
  "collections/create",
  "collections/update",
  "collections/delete",
  "inventory_levels/update",
]);

/**
 * True when `hmacHeader` (X-Shopify-Hmac-Sha256) is the base64 HMAC-SHA256 of
 * the exact raw request body under the webhook signing secret.
 */
export function verifyShopifyWebhook(
  rawBody: string,
  hmacHeader: string | null,
  secret: string,
): boolean {
  if (!hmacHeader || !secret) {
    return false;
  }

  const expected = createHmac("sha256", secret)
    .update(rawBody, "utf8")
    .digest();
  const received = Buffer.from(hmacHeader, "base64");

  // timingSafeEqual throws on length mismatch; a wrong length is a bad signature.
  return (
    received.length === expected.length && timingSafeEqual(received, expected)
  );
}
