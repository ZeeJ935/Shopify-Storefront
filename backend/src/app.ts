import Fastify, { type FastifyServerOptions } from "fastify";
import { requireServiceToken } from "./auth.js";
import { safeError } from "./errors.js";
import type { CustomersRepo } from "./db/client.js";
import type { FavouritesRepo } from "./db/favourites.js";
import { webhookRoutes, type WebhookRouteDeps } from "./routes/webhooks.js";
import { catalogRoutes, type CatalogRouteDeps } from "./routes/catalog.js";
import { favouritesRoutes } from "./routes/favourites.js";
import { healthRoutes, type HealthDetails } from "./routes/health.js";
import { inventoryRoutes, type InventoryRouteDeps } from "./routes/inventory.js";
import type { ReportError } from "./report.js";
import { meRoutes } from "./routes/me.js";
import type { AdminApiHealth } from "./shopify-admin/index.js";

export type AppDeps = {
  serviceToken: string;
  customers: CustomersRepo;
  favourites: FavouritesRepo;
  pingDb: () => Promise<void>;
  /** Extra /health fields: last catalog sync, failed webhooks (absent in tests that don't need them). */
  healthDetails?: () => Promise<HealthDetails>;
  /** Admin API reachability for /health (omitted when Admin is not configured). */
  adminApiHealth?: () => Promise<AdminApiHealth>;
  webhooks: WebhookRouteDeps;
  /** Catalog endpoints (absent in tests that don't need them). */
  catalog?: CatalogRouteDeps;
  /** Inventory endpoints (absent when Admin isn't configured). */
  inventory?: InventoryRouteDeps;
  logger?: FastifyServerOptions["logger"];
  /** Where unexpected errors go (Sentry + log). */
  report?: ReportError;
  /** Enables GET /v1/debug/sentry, which throws on purpose to test error reporting. */
  debugRoutes?: boolean;
};

/** Builds the app with its dependencies injected, so tests can run without a database. */
export function buildApp({
  serviceToken,
  customers,
  favourites,
  pingDb,
  healthDetails,
  adminApiHealth,
  webhooks,
  catalog,
  inventory,
  logger = false,
  report,
  debugRoutes = false,
}: AppDeps) {
  const app = Fastify({
    // Strict bodies: no type coercion ("1" for 1, "x" for ["x"]) and no silently dropped fields.
    ajv: { customOptions: { coerceTypes: false, removeAdditional: false } },
    logger:
      logger === false
        ? false
        : {
            ...(typeof logger === "object" ? logger : {}),
            // Belt and braces: request lines below never include headers, but if
            // anything logs a request object, the secrets are masked.
            redact: [
              "req.headers.authorization",
              'req.headers["x-customer-id"]',
              'req.headers["x-shopify-hmac-sha256"]',
              "req.headers.cookie",
            ],
          },
    // One structured line per request instead of Fastify's two (see onResponse below).
    disableRequestLogging: true,
  });

  // { reqId, method, route, status, durationMs }: the route pattern, never the URL
  // (query strings can carry anything), and no headers or bodies.
  app.addHook("onResponse", async (request, reply) => {
    request.log.info(
      {
        method: request.method,
        route: request.routeOptions.url ?? "unmatched",
        status: reply.statusCode,
        durationMs: Math.round(reply.elapsedTime * 10) / 10,
      },
      "request",
    );
  });

  // Our own error handler so 500s are logged without SQL parameters (customer IDs).
  // 4xx errors (validation, bad JSON) keep Fastify's normal response.
  app.setErrorHandler((error, request, reply) => {
    const code = (error as { statusCode?: unknown } | null)?.statusCode;
    const status = typeof code === "number" && code >= 400 ? code : 500;
    if (status < 500) return reply.send(error);
    const route = request.routeOptions.url ?? "unmatched";
    request.log.error({ err: safeError(error), route }, "request failed");
    report?.(error, { kind: "request", route });
    return reply.code(500).send({ error: "internal_error" });
  });

  healthRoutes(app, pingDb, healthDetails, Date.now, adminApiHealth);

  // Public: Shopify signs these; the HMAC is the auth (no service token).
  app.register((instance) => webhookRoutes(instance, webhooks));

  // Everything under /v1 needs the service token.
  app.register(
    async (v1) => {
      v1.addHook("onRequest", requireServiceToken(serviceToken));
      meRoutes(v1, customers);
      favouritesRoutes(v1, favourites);
      if (catalog) catalogRoutes(v1, catalog);
      if (inventory) inventoryRoutes(v1, inventory);
      // Throws on purpose so error reporting can be checked end to end.
      if (debugRoutes) {
        v1.get("/v1/debug/sentry", async () => {
          throw new Error("Sentry test error from the backend (GET /v1/debug/sentry)");
        });
      }
    },
  );

  return app;
}
