import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * True when `hmacHeader` (X-Shopify-Hmac-Sha256) is the base64 HMAC-SHA256 of
 * the exact raw request body under the webhook signing secret.
 * Same rule as the storefront's lib/shopify-webhook.ts.
 */
export function verifyShopifyHmac(rawBody: Buffer, hmacHeader: string | undefined, secret: string): boolean {
  if (!hmacHeader || !secret) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest();
  const received = Buffer.from(hmacHeader, "base64");
  // timingSafeEqual throws on a length mismatch; a wrong length is a bad signature.
  return received.length === expected.length && timingSafeEqual(received, expected);
}
