import type { FastifyInstance } from "fastify";
import { requireCustomer } from "../auth.js";
import { MAX_FAVOURITES, type FavouritesRepo } from "../db/favourites.js";

// Shopify product GIDs (gid://shopify/Product/123); loose on purpose.
const PRODUCT_ID = "^[A-Za-z0-9:/._-]{1,255}$";

// No maxItems here: PUT answers too_many_favourites itself, and import trims instead of failing.
const body = {
  type: "object",
  required: ["ids"],
  additionalProperties: false,
  properties: {
    ids: { type: "array", maxItems: 1000, items: { type: "string", pattern: PRODUCT_ID } },
  },
} as const;

type IdsBody = { Body: { ids: string[] } };

/** Unique, in the order given. */
const dedupe = (ids: string[]) => [...new Set(ids)];

export function favouritesRoutes(app: FastifyInstance, repo: FavouritesRepo) {
  app.get("/v1/favourites", { preHandler: requireCustomer }, async (request) => {
    return repo.list(request.customerId!);
  });

  /** Replaces the whole list. Same rule the storefront enforces: at most 200. */
  app.put<IdsBody>("/v1/favourites", { preHandler: requireCustomer, schema: { body } }, async (request, reply) => {
    const ids = dedupe(request.body.ids);
    if (ids.length > MAX_FAVOURITES) {
      return reply.code(400).send({ error: "too_many_favourites", max: MAX_FAVOURITES });
    }
    return { ids: await repo.replace(request.customerId!, ids) };
  });

  /**
   * One-time import used during the migration from the Shopify metafield (the storefront no
   * longer calls it; kept for a possible manual re-import). Safe to repeat; an oversized
   * old list is trimmed, not rejected.
   */
  app.post<IdsBody>("/v1/favourites/import", { preHandler: requireCustomer, schema: { body } }, async (request) => {
    const ids = dedupe(request.body.ids).slice(0, MAX_FAVOURITES);
    return repo.importOnce(request.customerId!, ids);
  });
}
