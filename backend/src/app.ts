import Fastify, { type FastifyServerOptions } from "fastify";
import { requireServiceToken } from "./auth.js";
import { safeError } from "./errors.js";
import type { CustomersRepo } from "./db/client.js";
import type { FavouritesRepo } from "./db/favourites.js";
import { webhookRoutes, type WebhookRouteDeps } from "./routes/webhooks.js";
import { catalogRoutes, type CatalogRouteDeps } from "./routes/catalog.js";
import { favouritesRoutes } from "./routes/favourites.js";
import { healthRoutes } from "./routes/health.js";
import { meRoutes } from "./routes/me.js";

export type AppDeps = {
  serviceToken: string;
  customers: CustomersRepo;
  favourites: FavouritesRepo;
  pingDb: () => Promise<void>;
  webhooks: WebhookRouteDeps;
  /** Catalog endpoints (absent in tests that don't need them). */
  catalog?: CatalogRouteDeps;
  logger?: FastifyServerOptions["logger"];
};

/** Builds the app with its dependencies injected, so tests can run without a database. */
export function buildApp({ serviceToken, customers, favourites, pingDb, webhooks, catalog, logger = false }: AppDeps) {
  const app = Fastify({
    // Strict bodies: no type coercion ("1" for 1, "x" for ["x"]) and no silently dropped fields.
    ajv: { customOptions: { coerceTypes: false, removeAdditional: false } },
    logger:
      logger === false
        ? false
        : {
            ...(typeof logger === "object" ? logger : {}),
            // Never log the service token or customer IDs.
            redact: ["req.headers.authorization", 'req.headers["x-customer-id"]'],
          },
  });

  // Our own error handler so 500s are logged without SQL parameters (customer IDs).
  // 4xx errors (validation, bad JSON) keep Fastify's normal response.
  app.setErrorHandler((error, request, reply) => {
    const code = (error as { statusCode?: unknown } | null)?.statusCode;
    const status = typeof code === "number" && code >= 400 ? code : 500;
    if (status < 500) return reply.send(error);
    request.log.error({ err: safeError(error), route: request.routeOptions.url }, "request failed");
    return reply.code(500).send({ error: "internal_error" });
  });

  healthRoutes(app, pingDb);

  // Public: Shopify signs these; the HMAC is the auth (no service token).
  app.register((instance) => webhookRoutes(instance, webhooks));

  // Everything under /v1 needs the service token.
  app.register(
    async (v1) => {
      v1.addHook("onRequest", requireServiceToken(serviceToken));
      meRoutes(v1, customers);
      favouritesRoutes(v1, favourites);
      if (catalog) catalogRoutes(v1, catalog);
    },
  );

  return app;
}
