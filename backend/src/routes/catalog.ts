import type { FastifyInstance } from "fastify";
import type pg from "pg";
import type { CatalogFilters, CatalogSort } from "../catalog-shared/types.js";
import {
  catalogOverview,
  DEFAULT_LIMIT,
  InvalidCursorError,
  MAX_LIMIT,
  productsByIds,
  queryCatalogSql,
  type CatalogQuery,
} from "../catalog/query.js";

export type CatalogRouteDeps = {
  pool: pg.Pool;
  /** Queues a full sync (absent when the catalog sync isn't configured). */
  enqueueFullSync?: (reason: string) => Promise<unknown>;
};

type Query = Record<string, string | string[] | undefined>;

const list = (q: Query, ...names: string[]) =>
  [...new Set(names.flatMap((n) => [q[n]].flat()).filter((v): v is string => typeof v === "string").map((v) => v.trim()).filter(Boolean))];
const one = (q: Query, name: string) => {
  const v = q[name];
  return (Array.isArray(v) ? v[0] : v)?.trim() || null;
};
const num = (v: string | null) => (v === null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));

const SORTS: Record<string, CatalogSort> = {
  featured: "featured",
  latest: "latest",
  newest: "latest",
  "price-asc": "price-asc",
  "price-desc": "price-desc",
  "name-asc": "name-asc",
  "title-asc": "name-asc",
  "name-desc": "name-desc",
  "title-desc": "name-desc",
  "best-selling": "best-selling",
};

/** Same parameters (and meanings) as the storefront's parseCatalogParams, plus limit, cursor and q. */
export function parseCatalogQuery(q: Query): CatalogQuery {
  const sale = one(q, "sale");
  const available = one(q, "available");
  const filters: CatalogFilters = {
    brand: list(q, "brand", "vendor"),
    type: list(q, "type"),
    gender: list(q, "gender"),
    size: list(q, "size"),
    color: list(q, "color"),
    sale: sale === "1" || sale === "true" ? true : null,
    available: available === "1" || available === "in-stock" ? true : available === "0" || available === "out-of-stock" ? false : null,
    priceMin: num(one(q, "price_min")),
    priceMax: num(one(q, "price_max")),
  };
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number(one(q, "limit") ?? DEFAULT_LIMIT) || DEFAULT_LIMIT));
  return {
    scope: one(q, "scope") ?? one(q, "collection"),
    filters,
    sort: SORTS[one(q, "sort") ?? "featured"] ?? "featured",
    page: Math.max(1, Number(one(q, "page") ?? "1") || 1),
    limit,
    cursor: one(q, "cursor"),
    q: one(q, "q")?.slice(0, 100) ?? null,
  };
}

export function catalogRoutes(app: FastifyInstance, deps: CatalogRouteDeps) {
  app.get("/v1/catalog", async (request, reply) => {
    try {
      return await queryCatalogSql(deps.pool, parseCatalogQuery(request.query as Query));
    } catch (error) {
      if (error instanceof InvalidCursorError) return reply.code(400).send({ error: "invalid_cursor" });
      throw error;
    }
  });

  app.get("/v1/products/by-ids", async (request, reply) => {
    const ids = list(request.query as Query, "ids").flatMap((v) => v.split(",")).map((v) => v.trim()).filter(Boolean);
    if (ids.length > 250) return reply.code(400).send({ error: "too_many_ids", max: 250 });
    return { products: await productsByIds(deps.pool, [...new Set(ids)]) };
  });

  app.get("/v1/catalog/overview", async () => catalogOverview(deps.pool));

  app.post("/v1/catalog/sync", async (_request, reply) => {
    if (!deps.enqueueFullSync) return reply.code(503).send({ error: "catalog_sync_not_configured" });
    await deps.enqueueFullSync("manual");
    return reply.code(202).send({ queued: true });
  });
}
