import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";
import { CATALOG_TAG } from "@/lib/shopify";
import { CATALOG_TOPICS, verifyShopifyWebhook } from "@/lib/shopify-webhook";

/**
 * Shopify admin webhooks (Settings → Notifications → Webhooks) call this when
 * products, collections or stock change, so the catalog refreshes in seconds
 * instead of waiting for the CATALOG_REVALIDATE timer.
 */
export async function POST(request: Request) {
  const secret = process.env.SHOPIFY_WEBHOOK_SECRET?.trim();
  if (!secret) {
    // 500 so Shopify retries once the secret is configured.
    console.error("[webhook] SHOPIFY_WEBHOOK_SECRET is not set");
    return NextResponse.json({ error: "Not configured" }, { status: 500 });
  }

  // The signature covers the exact bytes, so read the raw body before parsing.
  const rawBody = await request.text();
  if (
    !verifyShopifyWebhook(
      rawBody,
      request.headers.get("x-shopify-hmac-sha256"),
      secret,
    )
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const topic = request.headers.get("x-shopify-topic") ?? "";
  if (CATALOG_TOPICS.has(topic)) {
    // expire: 0 → the next visitor gets fresh data, never a stale price/stock.
    revalidateTag(CATALOG_TAG, { expire: 0 });
    console.info(`[webhook] ${topic} → catalog refreshed`);
  }

  // Acknowledge other topics too, so Shopify doesn't retry or disable them.
  return NextResponse.json({ ok: true });
}
