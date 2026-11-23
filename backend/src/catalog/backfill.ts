// One-off backfill: pages through the whole catalog (100 per page) and upserts it,
// then removes products Shopify no longer has. Safe to run again.
//   npm run catalog:backfill        (local, reads backend/.env)
//   npm run catalog:backfill:prod   (compiled, e.g. a Render shell)
import { createDb } from "../db/client.js";
import { readEnv } from "../env.js";
import { createRevalidator } from "../webhooks/process.js";
import { createCatalogStore } from "./store.js";
import { createStorefrontSource } from "./storefront.js";
import { fullSync } from "./sync.js";

const env = readEnv();
if (!env.shopifyStoreDomain || !env.shopifyStorefrontToken) {
  throw new Error("SHOPIFY_STORE_DOMAIN and SHOPIFY_STOREFRONT_ACCESS_TOKEN are required for the backfill.");
}
const db = createDb(env.databaseUrl);
try {
  const started = Date.now();
  const result = await fullSync({
    source: createStorefrontSource({ storeDomain: env.shopifyStoreDomain, token: env.shopifyStorefrontToken }),
    store: createCatalogStore(db.pool),
  });
  console.log(`catalog backfill: ${result.products} products, ${result.deleted} removed, ${Math.round((Date.now() - started) / 100) / 10}s`);
  if (env.storefrontUrl) {
    await createRevalidator(env.storefrontUrl, env.serviceToken)().catch((e) => console.warn("revalidate skipped:", e.message));
  }
} finally {
  await db.close();
}
