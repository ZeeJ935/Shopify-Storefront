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

const env = readEnv();
const report = createReporter();
const db = createDb(env.databaseUrl);
const queue = createWebhookQueue(env.databaseUrl);

if (!env.shopifyWebhookSecret) console.warn("[webhooks] SHOPIFY_WEBHOOK_SECRET is not set: webhooks will get 500");
if (!env.storefrontUrl) console.warn("[webhooks] STOREFRONT_URL is not set: catalog webhooks will fail and retry");

const revalidate = createRevalidator(env.storefrontUrl, env.serviceToken);
const catalogStore = createCatalogStore(db.pool);
const source =
  env.shopifyStoreDomain && env.shopifyStorefrontToken
    ? createStorefrontSource({ storeDomain: env.shopifyStoreDomain, token: env.shopifyStorefrontToken })
    : null;
if (!source) console.warn("[catalog] SHOPIFY_STORE_DOMAIN / SHOPIFY_STOREFRONT_ACCESS_TOKEN not set: catalog sync is off");

await queue.init();
const catalogJobs = createCatalogJobs(queue.boss, report);

const app = buildApp({
  serviceToken: env.serviceToken,
  customers: db.customers,
  favourites: db.favourites,
  pingDb: db.ping,
  healthDetails: db.healthDetails,
  report,
  debugRoutes: true,
  webhooks: { secret: env.shopifyWebhookSecret, intake: createWebhookIntake(db.pool, queue.enqueueOnClient) },
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
  // First deploy: fill the catalog straight away instead of waiting for the night.
  if ((await catalogStore.count()) === 0) await catalogJobs.enqueueFullSync("initial");
}

const webhookStore = createWebhookStore(db.pool);
const catalog = source ? createCatalogHandler({ source, store: catalogStore, scheduleFullSync: catalogJobs.scheduleFullSync }) : undefined;
await queue.start(async (eventId) => {
  await processWebhookEvent(eventId, {
    store: webhookStore,
    revalidate,
    catalog,
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
