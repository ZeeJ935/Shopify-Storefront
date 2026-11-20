import Fastify, { type FastifyServerOptions } from "fastify";
import { requireServiceToken } from "./auth.js";
import type { CustomersRepo } from "./db/client.js";
import type { FavouritesRepo } from "./db/favourites.js";
import { favouritesRoutes } from "./routes/favourites.js";
import { healthRoutes } from "./routes/health.js";
import { meRoutes } from "./routes/me.js";

export type AppDeps = {
  serviceToken: string;
  customers: CustomersRepo;
  favourites: FavouritesRepo;
  pingDb: () => Promise<void>;
  logger?: FastifyServerOptions["logger"];
};

/** Builds the app with its dependencies injected, so tests can run without a database. */
export function buildApp({ serviceToken, customers, favourites, pingDb, logger = false }: AppDeps) {
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

  healthRoutes(app, pingDb);

  // Everything under /v1 needs the service token.
  app.register(
    async (v1) => {
      v1.addHook("onRequest", requireServiceToken(serviceToken));
      meRoutes(v1, customers);
      favouritesRoutes(v1, favourites);
    },
  );

  return app;
}
