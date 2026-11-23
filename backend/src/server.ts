import "./instrument.js"; // first: Sentry must load before anything else
import { buildApp } from "./app.js";
import { createAuditStore } from "./admin/audit.js";
import { createGoogleVerifier } from "./admin/google.js";
import { createStaffStore } from "./admin/staff.js";
import { createCatalogHandler } from "./catalog/handlers.js";
import { createCatalogJobs } from "./catalog/jobs.js";
import { createCatalogStore } from "./catalog/store.js";
import { createStorefrontSource } from "./catalog/storefront.js";
import { fullSync as catalogFullSync } from "./catalog/sync.js";
import { createDb } from "./db/client.js";
import { createWebhookIntake, createWebhookStore } from "./db/webhooks.js";
import { readEnv } from "./env.js";
import { createAdminInventorySource } from "./inventory/admin-source.js";
import { createInventoryHandlers } from "./inventory/handlers.js";
import { createInventoryJobs } from "./inventory/jobs.js";
import { createInventoryStore } from "./inventory/store.js";
import { fullSync as inventoryFullSync } from "./inventory/sync.js";
import { createAdminFulfillmentsSource } from "./fulfillments/admin-source.js";
import { createFulfillmentActionsShopify } from "./fulfillments/actions-admin.js";
import { markFulfillmentActionFailed, runFulfillmentAction } from "./fulfillments/actions.js";
import { createFulfillmentHandlers } from "./fulfillments/handlers.js";
import { createFulfillmentJobs } from "./fulfillments/jobs.js";
import { createFulfillmentsStore } from "./fulfillments/store.js";
import { refreshOrderFulfillments, type RefreshDeps } from "./fulfillments/sync.js";
import { createAdminOrdersSource } from "./orders/admin-source.js";
import { createOrdersHandlers } from "./orders/handlers.js";
import { createOrdersJobs } from "./orders/jobs.js";
import { createOrdersStore } from "./orders/store.js";
import { fullSync as ordersFullSync } from "./orders/sync.js";
import { createWebhookQueue } from "./queue.js";
import { createWebhookMaintenanceJobs, createWebhookMaintenanceStore, recoverStuckWebhooks } from "./webhooks/maintenance.js";
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
const inventoryJobs = createInventoryJobs(queue.boss, report);
const ordersJobs = createOrdersJobs(queue.boss, report);
const fulfillmentJobs = createFulfillmentJobs(queue.boss, report);
const inventoryStore = createInventoryStore(db.pool);
const ordersStore = createOrdersStore(db.pool);
const inventorySource = admin ? createAdminInventorySource(admin) : null;
const ordersSource = admin ? createAdminOrdersSource(admin) : null;

const catalogHandler = source
  ? createCatalogHandler({ source, store: catalogStore, scheduleFullSync: catalogJobs.scheduleFullSync })
  : undefined;

const inventoryHandlers = inventorySource
  ? createInventoryHandlers({ source: inventorySource, store: inventoryStore })
  : undefined;

const logWebhookLine = (line: { topic: string; id: string | number | null; handler: string }) =>
  console.info(JSON.stringify({ level: "info", msg: "webhook placeholder", ...line }));

// Fulfillment orders + fulfillments, refreshed per order (needs Admin).
const fulfillmentsStore = createFulfillmentsStore(db.pool);
const fulfillmentsSource = admin ? createAdminFulfillmentsSource(admin) : null;
const fulfillmentDeps: RefreshDeps | null =
  fulfillmentsSource && ordersSource
    ? {
        source: fulfillmentsSource,
        store: fulfillmentsStore,
        // A fulfillment webhook can arrive before the order is stored: fetch the order first.
        ensureOrder: async (orderGid) => {
          const remote = await ordersSource.order(orderGid);
          if (!remote) return false;
          await ordersStore.upsertOrder(remote);
          return true;
        },
      }
    : null;
const refreshFulfillments = fulfillmentDeps
  ? (orderGid: string) => refreshOrderFulfillments(fulfillmentDeps, orderGid)
  : undefined;

const ordersHandler = ordersSource
  ? createOrdersHandlers({
      source: ordersSource,
      store: ordersStore,
      logSkip: (line) => console.info(JSON.stringify({ level: "info", msg: "orders webhook skipped", ...line })),
      onOrderChanged: refreshFulfillments,
    })
  : undefined;

const fulfillmentHandlers = fulfillmentDeps
  ? createFulfillmentHandlers({
      ...fulfillmentDeps,
      logSkip: (line) => console.info(JSON.stringify({ level: "info", msg: "fulfillments webhook skipped", ...line })),
    })
  : undefined;

const webhookRouter = buildWebhookRegistry({
  catalog: catalogHandler,
  inventory: inventoryHandlers,
  orders: ordersHandler,
  fulfillments: fulfillmentHandlers,
  revalidate,
  // Structured line; no payload fields — placeholders only log topic + id.
  logPlaceholder: logWebhookLine,
});

const app = buildApp({
  serviceToken: env.serviceToken,
  customers: db.customers,
  favourites: db.favourites,
  pingDb: db.ping,
  healthDetails: db.healthDetails,
  adminApiHealth: admin ? () => admin.checkHealth() : undefined,
  report,
  // Off unless SENTRY_DEBUG=1.
  debugRoutes: env.debugRoutes,
  webhooks: {
    secrets: webhookSecrets,
    intake: createWebhookIntake(db.pool, queue.enqueueOnClient),
    router: webhookRouter,
  },
  catalog: { pool: db.pool, enqueueFullSync: source ? catalogJobs.enqueueFullSync : undefined },
  inventory: inventorySource
    ? { pool: db.pool, enqueueFullSync: inventoryJobs.enqueueFullSync }
    : undefined,
  orders: ordersSource ? { pool: db.pool, enqueueFullSync: ordersJobs.enqueueFullSync } : undefined,
  // Dry runs work without Admin; real fulfillments need it.
  fulfillments: { pool: db.pool, enqueueOnClient: admin ? fulfillmentJobs.enqueueOnClient : undefined },
  // Staff admin (/admin/*): only when ADMIN_API_TOKEN, ADMIN_JWT_SECRET and ADMIN_GOOGLE_CLIENT_ID are set.
  staffAdmin: env.staffAdmin
    ? {
        env: env.staffAdmin,
        pool: db.pool,
        verifyGoogle: createGoogleVerifier({ clientId: env.staffAdmin.googleClientId, hostedDomain: env.staffAdmin.googleHostedDomain }),
        staff: createStaffStore(db.pool),
        audit: createAuditStore(db.pool),
        report,
        sync: {
          catalog: source ? catalogJobs.enqueueFullSync : undefined,
          inventory: inventorySource ? inventoryJobs.enqueueFullSync : undefined,
          orders: ordersSource ? ordersJobs.enqueueFullSync : undefined,
        },
        enqueueFulfillment: admin ? fulfillmentJobs.enqueueOnClient : undefined,
      }
    : undefined,
  logger: { level: process.env.LOG_LEVEL ?? "info" },
});

if (source) {
  const deps = { source, store: catalogStore };
  await catalogJobs.start(async (reason) => {
    const result = await catalogFullSync(deps);
    app.log.info({ reason, ...result }, "catalog full sync finished");
    await revalidate();
  });
  if ((await catalogStore.count()) === 0) await catalogJobs.enqueueFullSync("initial");
}

if (inventorySource) {
  await inventoryJobs.start(async (reason) => {
    const result = await inventoryFullSync({ source: inventorySource, store: inventoryStore });
    app.log.info({ reason, ...result }, "inventory full sync finished");
  });
  // Same singleton as POST /v1/inventory/sync — restarts on an empty store do not pile up jobs.
  if ((await inventoryStore.countLocations()) === 0) await inventoryJobs.enqueueFullSync("initial");
}

if (ordersSource) {
  await ordersJobs.start(async (reason) => {
    const result = await ordersFullSync({ source: ordersSource, store: ordersStore, onOrderChanged: refreshFulfillments });
    app.log.info({ reason, ...result }, "orders full sync finished");
  });
  if ((await ordersStore.countOrders()) === 0) await ordersJobs.enqueueFullSync("initial");
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

if (admin) {
  const fulfillmentShopify = createFulfillmentActionsShopify(admin);
  await fulfillmentJobs.start({
    run: async (actionId) => {
      const result = await runFulfillmentAction(
        {
          pool: db.pool,
          shopify: fulfillmentShopify,
          refreshOrder: refreshFulfillments,
          onRefreshError: (error) => report(error, { kind: "job", job: "fulfillment-refresh", action_id: String(actionId) }),
        },
        actionId,
      );
      app.log.info({ actionId, result }, "fulfillment action");
    },
    onFinalFailure: (actionId, error) => markFulfillmentActionFailed(db.pool, actionId, error),
  });
}

// Stuck-event recovery (every 15 min) and webhook_events retention (daily).
const maintenanceStore = createWebhookMaintenanceStore(db.pool);
await createWebhookMaintenanceJobs(queue.boss, report).start({
  recover: async () => {
    const result = await recoverStuckWebhooks({
      store: maintenanceStore,
      requeue: queue.requeue,
      report,
      log: (line) => console.info(JSON.stringify({ level: "info", ...line })),
    });
    if (result.requeued || result.failed) app.log.info(result, "stuck webhooks handled");
  },
  purge: async () => {
    const result = await maintenanceStore.purgeOld();
    app.log.info(result, "webhook_events purged");
  },
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
