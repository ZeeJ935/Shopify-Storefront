import { buildApp } from "./app.js";
import { createDb } from "./db/client.js";
import { createWebhookIntake, createWebhookStore } from "./db/webhooks.js";
import { readEnv } from "./env.js";
import { createWebhookQueue } from "./queue.js";
import { createRevalidator, processWebhookEvent } from "./webhooks/process.js";

const env = readEnv();
const db = createDb(env.databaseUrl);
const queue = createWebhookQueue(env.databaseUrl);

if (!env.shopifyWebhookSecret) console.warn("[webhooks] SHOPIFY_WEBHOOK_SECRET is not set: webhooks will get 500");
if (!env.storefrontUrl) console.warn("[webhooks] STOREFRONT_URL is not set: catalog webhooks will fail and retry");

const app = buildApp({
  serviceToken: env.serviceToken,
  customers: db.customers,
  favourites: db.favourites,
  pingDb: db.ping,
  webhooks: { secret: env.shopifyWebhookSecret, intake: createWebhookIntake(db.pool, queue.enqueueOnClient) },
  logger: { level: process.env.LOG_LEVEL ?? "info" },
});

const store = createWebhookStore(db.pool);
const revalidate = createRevalidator(env.storefrontUrl, env.serviceToken);
await queue.start(async (eventId) => {
  const result = await processWebhookEvent(eventId, { store, revalidate });
  if (result === "failed") app.log.error({ eventId }, "webhook failed after the last attempt");
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
