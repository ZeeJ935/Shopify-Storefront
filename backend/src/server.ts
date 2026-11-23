import "./instrument.js"; // first: Sentry must load before anything else
import { buildApp } from "./app.js";
import { createCatalogHandler } from "./catalog/handlers.js";
import { createCatalogJobs } from "./catalog/jobs.js";
import { createCatalogStore } from "./catalog/store.js";
import { createStorefrontSource } from "./catalog/storefront.js";
import { fullSync } from "./catalog/sync.js";
import { createDb } from "./db/client.js";
import { createWebhookIntake, createWebhookStore } from "./db/webhooks.js";
import { readEnv } from "./env.js";
import { createWebhookQueue } from "./queue.js";
import { createRevalidator, processWebhookEvent } from "./webhooks/process.js";
import { createReporter } from "./report.js";
import { createShopifyAdmin } from "./shopify-admin/index.js";
import { buildWebhookRegistry } from "./webhooks/registry.js";

const env = readEnv();
const report = createReporter();
const db = createDb(env.databaseUrl);
const queue = createWebhookQueue(env.databaseUrl);

const webhookSecrets = [env.shopifyWebhookSecret, env.shopifyAdminClientSecret].filter(
  (s): s is string => typeof s === "string" && s.length > 0,
);
if (webhookSecrets.length === 0) {
  console.warn("[webhooks] SHOPIFY_WEBHOOK_SECRET / SHOPIFY_ADMIN_CLIENT_SECRET not set: webhooks will get 500");
}
if (!env.storefrontUrl) console.warn("[webhooks] STOREFRONT_URL is not set: catalog webhooks will fail and retry");

const revalidate = createRevalidator(env.storefrontUrl, env.serviceToken);
const catalogStore = createCatalogStore(db.pool);
const source =
  env.shopifyStoreDomain && env.shopifyStorefrontToken
    ? createStorefrontSource({ storeDomain: env.shopifyStoreDomain, token: env.shopifyStorefrontToken })
    : null;
if (!source) console.warn("[catalog] SHOPIFY_STORE_DOMAIN / SHOPIFY_STOREFRONT_ACCESS_TOKEN not set: catalog sync is off");

const admin =
  env.shopifyStoreDomain && env.shopifyAdminClientId && env.shopifyAdminClientSecret
    ? createShopifyAdmin({
        storeDomain: env.shopifyStoreDomain,
        clientId: env.shopifyAdminClientId,
        clientSecret: env.shopifyAdminClientSecret,
        apiVersion: env.shopifyAdminApiVersion,
      })
    : null;
if (!admin) {
  console.warn("[admin] SHOPIFY_ADMIN_CLIENT_ID / SHOPIFY_ADMIN_CLIENT_SECRET (and SHOPIFY_STORE_DOMAIN) not set: Admin API is off");
}

await queue.init();
const catalogJobs = createCatalogJobs(queue.boss, report);

const catalogHandler = source
  ? createCatalogHandler({ source, store: catalogStore, scheduleFullSync: catalogJobs.scheduleFullSync })
  : undefined;

const webhookRouter = buildWebhookRegistry({
  catalog: catalogHandler,
  revalidate,
  // Structured line; no payload fields — placeholders only log topic + id.
  logPlaceholder: (line) => console.info(JSON.stringify({ level: "info", msg: "webhook placeholder", ...line })),
});

const app = buildApp({
  serviceToken: env.serviceToken,
  customers: db.customers,
  favourites: db.favourites,
  pingDb: db.ping,
  healthDetails: db.healthDetails,
  adminApiHealth: admin ? () => admin.checkHealth() : undefined,
  report,
  debugRoutes: true,
  webhooks: {
    secrets: webhookSecrets,
    intake: createWebhookIntake(db.pool, queue.enqueueOnClient),
    router: webhookRouter,
  },
  catalog: { pool: db.pool, enqueueFullSync: source ? catalogJobs.enqueueFullSync : undefined },
  logger: { level: process.env.LOG_LEVEL ?? "info" },
});

if (source) {
  const deps = { source, store: catalogStore };
  await catalogJobs.start(async (reason) => {
    const result = await fullSync(deps);
    app.log.info({ reason, ...result }, "catalog full sync finished");
    await revalidate();
  });
  if ((await catalogStore.count()) === 0) await catalogJobs.enqueueFullSync("initial");
}

const webhookStore = createWebhookStore(db.pool);
await queue.start(async (eventId) => {
  await processWebhookEvent(eventId, {
    store: webhookStore,
    router: webhookRouter,
    onFinalFailure: ({ eventId: id, topic }, error) =>
      report(error, { kind: "webhook", topic, event_id: String(id) }),
  });
});

const shutdown = async () => {
  await app.close();
  await queue.stop();
  await db.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

await app.listen({ host: env.host, port: env.port });
