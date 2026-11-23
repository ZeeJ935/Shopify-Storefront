import { CATALOG_TOPICS } from "./topics.js";
import { createTopicRouter, type TopicRouter, type WebhookHandler } from "./router.js";
import { registerPlaceholders, type PlaceholderLog } from "./placeholders.js";

export type BuildRegistryOpts = {
  /** Updates the Postgres catalog for a catalog topic (absent when Storefront isn't configured). */
  catalog?: (topic: string, payload: unknown) => Promise<void>;
  /** Clears the storefront catalog cache. Required for catalog topics (same as today). */
  revalidate: () => Promise<void>;
  /** Inventory handlers (Admin-backed). When set, replace location/item placeholders. */
  inventory?: {
    levelsUpdate: WebhookHandler;
    itemUpdate: WebhookHandler;
    locationUpsert: WebhookHandler;
    locationDelete: WebhookHandler;
  };
  /** Orders handler (Admin-backed). When set, replace order placeholders. */
  orders?: WebhookHandler;
  /** Fulfillment handlers (Admin-backed). When set, replace fulfillment placeholders. */
  fulfillments?: { fulfillmentOrder: WebhookHandler; fulfillment: WebhookHandler };
  logPlaceholder?: PlaceholderLog;
};

/**
 * Default router: catalog topics keep exact current behaviour; inventory handlers
 * sit between catalog and revalidate on inventory_levels/update.
 */
export function buildWebhookRegistry(opts: BuildRegistryOpts): TopicRouter {
  const router = createTopicRouter();

  const catalogHandler: WebhookHandler = {
    name: "catalog",
    async handle(event) {
      if (opts.catalog) await opts.catalog(event.topic, event.payload);
    },
  };
  const revalidateHandler: WebhookHandler = {
    name: "revalidate",
    async handle() {
      await opts.revalidate();
    },
  };

  for (const topic of CATALOG_TOPICS) {
    router.register(topic, catalogHandler);
    if (topic === "inventory_levels/update" && opts.inventory) {
      router.register(topic, opts.inventory.levelsUpdate);
    }
    router.register(topic, revalidateHandler);
  }

  if (opts.inventory) {
    router.register("inventory_items/update", opts.inventory.itemUpdate);
    router.register("locations/create", opts.inventory.locationUpsert);
    router.register("locations/update", opts.inventory.locationUpsert);
    router.register("locations/delete", opts.inventory.locationDelete);
  }

  if (opts.orders) {
    for (const topic of ["orders/create", "orders/paid", "orders/updated", "orders/cancelled"] as const) {
      router.register(topic, opts.orders);
    }
  }

  if (opts.fulfillments) {
    router.registerPrefix("fulfillment_orders/", opts.fulfillments.fulfillmentOrder);
    router.register("fulfillments/create", opts.fulfillments.fulfillment);
    router.register("fulfillments/update", opts.fulfillments.fulfillment);
  }

  registerPlaceholders(router, opts.logPlaceholder, {
    skipLocationAndItem: Boolean(opts.inventory),
    skipOrders: Boolean(opts.orders),
    skipFulfillments: Boolean(opts.fulfillments),
  });
  return router;
}
