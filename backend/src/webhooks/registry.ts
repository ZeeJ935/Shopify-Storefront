import { CATALOG_TOPICS } from "./topics.js";
import { createTopicRouter, type TopicRouter, type WebhookHandler } from "./router.js";
import { registerPlaceholders, type PlaceholderLog } from "./placeholders.js";

export type BuildRegistryOpts = {
  /** Updates the Postgres catalog for a catalog topic (absent when Storefront isn't configured). */
  catalog?: (topic: string, payload: unknown) => Promise<void>;
  /** Clears the storefront catalog cache. Required for catalog topics (same as today). */
  revalidate: () => Promise<void>;
  logPlaceholder?: PlaceholderLog;
};

/**
 * Default router: catalog topics keep exact current behaviour (catalog then revalidate);
 * placeholder topics log and finish. Multiple handlers per topic run in registration order.
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
    router.register(topic, revalidateHandler);
  }

  registerPlaceholders(router, opts.logPlaceholder);
  return router;
}
