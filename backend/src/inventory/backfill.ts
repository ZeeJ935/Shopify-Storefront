// One-off inventory backfill via Admin GraphQL (paged; no bulk ops).
//   npm run inventory:backfill
//   npm run inventory:backfill:prod
import { createDb } from "../db/client.js";
import { readEnv } from "../env.js";
import { createShopifyAdmin } from "../shopify-admin/index.js";
import { createAdminInventorySource } from "./admin-source.js";
import { createInventoryStore } from "./store.js";
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
    source: createAdminInventorySource(admin),
    store: createInventoryStore(db.pool),
  });
  console.log(
    `inventory backfill: ${result.locations} locations, ${result.items} items, ${result.levels} levels applied, ` +
      `${result.deletedLocations}/${result.deletedItems}/${result.deletedLevels} removed, ` +
      `${Math.round((Date.now() - started) / 100) / 10}s`,
  );
} finally {
  await db.close();
}
