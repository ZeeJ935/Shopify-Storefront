// One-off orders backfill via Admin GraphQL (paged; last 60 days; no bulk ops).
//   npm run orders:backfill
//   npm run orders:backfill:prod
import { createDb } from "../db/client.js";
import { readEnv } from "../env.js";
import { createShopifyAdmin } from "../shopify-admin/index.js";
import { createAdminOrdersSource } from "./admin-source.js";
import { createOrdersStore } from "./store.js";
import { fullSync } from "./sync.js";

const env = readEnv();
if (!env.shopifyStoreDomain || !env.shopifyAdminClientId || !env.shopifyAdminClientSecret) {
  throw new Error("SHOPIFY_STORE_DOMAIN, SHOPIFY_ADMIN_CLIENT_ID and SHOPIFY_ADMIN_CLIENT_SECRET are required.");
}

const db = createDb(env.databaseUrl);
try {
  const started = Date.now();
  const admin = createShopifyAdmin({
    storeDomain: env.shopifyStoreDomain,
    clientId: env.shopifyAdminClientId,
    clientSecret: env.shopifyAdminClientSecret,
    apiVersion: env.shopifyAdminApiVersion,
  });
  const result = await fullSync({
    source: createAdminOrdersSource(admin),
    store: createOrdersStore(db.pool),
  });
  console.log(
    `orders backfill: ${result.orders} orders read, ${result.applied} applied, ` +
      `${Math.round((Date.now() - started) / 100) / 10}s`,
  );
} finally {
  await db.close();
}
